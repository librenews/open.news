import { publishToBluesky, uploadMediaToBluesky } from './bluesky-client.js';
import { getLexiconByCategory, getLexiconFromPost } from './lexicons.js';
import { BskyAgent } from '@atproto/api';
import { getPostMapping, insertPostMapping } from '../db/queries/weblog.js';

interface MetaWeblogPost {
  title: string;
  description: string;
  categories?: string[];
  dateCreated?: Date;
  mt_keywords?: string;
  mt_excerpt?: string;
  custom_fields?: Array<{
    key: string;
    value: string;
  }>;
  // Support direct lexicon field (some clients)
  lexicon?: string;
}

export async function handleMetaWeblogCall(methodName: string, params: any[], serverUrl: string = 'http://localhost:3001') {
  console.log(`[RAW XML-RPC] Executing ${methodName} natively...`);

  switch (methodName) {
    case 'system.listMethods':
    case 'mt.supportedMethods':
      return [
        'wp.newPost', 'wp.editPost', 'wp.getPost', 'wp.getPosts',
        'wp.getUsersBlogs', 'wp.getTerms', 'wp.getTaxonomies',
        'wp.getOptions', 'blogger.getUserInfo', 'wp.getProfile'
      ];
      
    case 'metaWeblog.newPost':
    case 'wp.newPost':
      return await handleNewPost(params, methodName);
    
    case 'metaWeblog.editPost':
      return await handleEditPost(params);
    case 'wp.editPost':
      return await handleEditPost([params[3], params[1], params[2]]);
      
    case 'metaWeblog.newMediaObject':
    case 'wp.uploadFile':
      return await handleUploadFile(params, serverUrl);
    
    case 'metaWeblog.getPost':
      return await handleGetPost(params, serverUrl);
    case 'wp.getPost':
      return await handleGetPost([params[3], params[1], params[2]], serverUrl);
    
    case 'metaWeblog.getRecentPosts':
      return await handleGetRecentPosts(params);
    case 'wp.getPosts':
      return await handleGetRecentPosts([params[0], params[1], params[2], params[3]?.number || 10]);
    
    case 'metaWeblog.getUsersBlogs':
    case 'blogger.getUsersBlogs':
    case 'wp.getUsersBlogs':
      return await handleGetUserBlogs(params, serverUrl);
    
    case 'blogger.getUserInfo':
    case 'wp.getProfile':
      return await handleGetUserInfo(params);
    
    case 'metaWeblog.getCategories':
    case 'wp.getCategories':
    case 'wp.getTerms':
    case 'wp.getTaxonomies':
      return [];
      
    case 'wp.getOptions':
      const reqOptions = params[3] || [];
      const masterOptions: any = {
        software_name: { desc: 'Software Name', readonly: true, value: 'WordPress' },
        software_version: { desc: 'Software Version', readonly: true, value: '6.5' },
        blog_title: { desc: 'Blog Title', readonly: false, value: 'AT Protocol Bridge' },
        blog_url: { desc: 'Blog URL', readonly: false, value: serverUrl },
        time_zone: { desc: 'Time Zone', readonly: false, value: '0' },
        thumbnail_size_w: { desc: 'Thumb Width', readonly: false, value: 150 },
        thumbnail_size_h: { desc: 'Thumb Height', readonly: false, value: 150 },
        medium_size_w: { desc: 'Medium Width', readonly: false, value: 300 },
        medium_size_h: { desc: 'Medium Height', readonly: false, value: 300 },
        large_size_w: { desc: 'Large Width', readonly: false, value: 1024 },
        large_size_h: { desc: 'Large Height', readonly: false, value: 1024 },
        post_thumbnail: { desc: 'Post Thumbnail', readonly: false, value: true }
      };
      
      if (!reqOptions || reqOptions.length === 0) return masterOptions;
      
      const result: any = {};
      for (const key of reqOptions) {
        if (masterOptions[key]) {
          result[key] = masterOptions[key];
        } else {
          result[key] = { desc: key, readonly: true, value: '' };
        }
      }
      return result;
      
    case 'system.listMethods':
      return [
        'metaWeblog.newPost',
        'wp.newPost',
        'wp.getPost',
        'wp.editPost',
        'wp.getPosts',
        'wp.getTerms',
        'wp.getTaxonomies',
        'metaWeblog.editPost',
        'metaWeblog.getPost',
        'metaWeblog.getRecentPosts',
        'blogger.getUsersBlogs',
        'blogger.getUserInfo',
        'wp.getOptions',
        'system.listMethods'
      ];
      
    default:
      throw new Error(`Method ${methodName} not implemented`);
  }
}

async function handleNewPost(params: any[], methodName: string = 'metaWeblog.newPost') {
  const [blogId, handle, appPassword, post, publish] = params as [
    string,
    string,
    string,
    any,
    boolean
  ];

  if (!handle || !appPassword) {
    throw new Error('Handle and app password are required');
  }

  // normalize generic metaweblog to specialized wp formats
  const title = post.title || post.post_title || '';
  const body = post.description || post.post_content || '';

  console.log('--- INTERCEPTED MARSEDIT POST BODY ---');
  console.log(body);
  try {
    const fs = await import('fs');
    fs.writeFileSync('/tmp/marsedit_post.txt', body || '');
  } catch(e){}

  if (!title && !body) {
    throw new Error('Post must have either title or content');
  }

  // Extract lexicon from custom fields or direct parameter
  let lexiconParam = post.lexicon;
  if (!lexiconParam && post.custom_fields) {
    const lexiconField = post.custom_fields.find((field: any) => 
      field.key.toLowerCase() === 'lexicon'
    );
    lexiconParam = lexiconField?.value;
  }

  // Determine lexicon from custom field, categories, or use default
  let lexicon = getLexiconFromPost(lexiconParam, post.categories);
  
  if (lexicon === 'app.bsky.feed.post' && (body.includes('<!-- wp:') || title)) {
      console.log('Upgrading payload to Leaflet (Gutenberg blocks or title detected).');
      lexicon = 'pub.leaflet.document';
  }
  
  try {

  const blueskyPost = {
    title: title || 'Untitled Post',
    body: body || '',
    tags: post.categories || post.terms_names?.category || [],
    lexicon,
    keywords: post.mt_keywords || post.custom_fields?.find((f: any) => f.key === 'keywords')?.value,
    excerpt: post.mt_excerpt || post.post_excerpt
  };

  const result = await publishToBluesky(handle, appPassword, blueskyPost);
  // iOS rigidly enforces integer tracking for Posts. Return a randomized stable integer ID
  // instead of the AT Protocol URI so it doesn't evaluate to 0 and corrupt local Core Data.
  const pseudoId = Math.floor(Math.random() * 2147483647);
  await insertPostMapping(pseudoId, result, handle, post.post_content || post.description || '');
  
  return String(pseudoId); // Ulysses expects string type primitives natively even for wp.newPost
  } catch (error) {
    console.error('Error creating post:', error);
    throw error;
  }
}

async function handleUploadFile(params: any[], serverUrl: string) {
  const [blogId, handle, appPassword, data] = params as [string, string, string, any];
  
  if (!handle || !appPassword) {
    throw new Error('Handle and app password are required');
  }

  try {
    const fileName = data.name || 'uploaded_image.jpg';
    let mimeType = data.type || 'image/jpeg';
    
    // Normalize basic mime type bindings for safety
    if (mimeType.includes('jpg')) mimeType = 'image/jpeg';
    
    // Extract base64 buffer generically maps node-xmlrpc Buffer mapping
    let fileBuffer: Uint8Array;
    if (Buffer.isBuffer(data.bits)) {
      fileBuffer = new Uint8Array(data.bits);
    } else {
      fileBuffer = new Uint8Array(Buffer.from(data.bits.toString(), 'base64'));
    }

    const { url, mime, cid } = await uploadMediaToBluesky(handle, appPassword, fileName, mimeType, fileBuffer, serverUrl);
    
    // Legacy generic metaweblog responses exclusively require an `id`, `file`, `url`, `type` map
    return {
      id: cid, // Fake a string struct natively proxying cid
      file: fileName,
      url: url,
      type: mime
    };
  } catch (error) {
    console.error('Failed to functionally proxy media struct mapping:', error);
    throw new Error('Upload error cleanly intercepted');
  }
}

async function handleEditPost(params: any[]) {
  // For now, editing is not supported in AT Protocol
  // This would require storing post mappings
  throw new Error('Post editing is not yet supported');
}

async function handleGetPost(params: any[], serverUrl: string = 'http://localhost:3001') {
  console.log('GET POST PARAMS RECEIVED:', JSON.stringify(params, null, 2));
  
  const [postId, handle, appPassword] = params;

  if (postId === undefined || postId === null || !handle || !appPassword) {
    throw new Error(`Post ID, handle, and app password are required. Got bounds: postId=${postId}, handle=${handle}, pass=${appPassword ? 'yes' : 'no'}`);
  }

  console.log('Getting post with ID:', postId);
  console.log('For user:', handle);

  try {
    const agent = new BskyAgent({ service: 'https://bsky.social' });
    await agent.login({ identifier: handle, password: appPassword });

    if (!agent.session?.did) {
      throw new Error('Failed to authenticate with Bluesky');
    }

    let did = '';
    let collection = '';
    let rkey = '';

    const postUri = String(postId);
    const numericId = parseInt(postUri, 10);
    
    const mappingRow = await getPostMapping(numericId);
    
    let preservedHtml = '';
    
    if (mappingRow) {
      console.log('Resolved iOS numeric ID to cached AT-URI:', mappingRow.uri);
      const mappedUri = mappingRow.uri;
      preservedHtml = mappingRow.original_content || '';
      const parts = mappedUri.slice(5).split('/');
      did = parts[0] || '';
      collection = parts[1] || '';
      rkey = parts[2] || '';
    } else if (!postUri.startsWith('at://')) {
      console.log('Numeric ID un-mapped, requesting fallback from pub.leaflet.document records...');
      const userFeed = await agent.com.atproto.repo.listRecords({
        repo: handle,
        collection: 'pub.leaflet.document',
        limit: 1
      });
      if (!userFeed.data.records || userFeed.data.records.length === 0) {
        throw new Error('No posts found for user to satisfy sync request.');
      }
      
      const firstRecord = userFeed.data.records[0];
      if (!firstRecord) throw new Error("First record undefined");
      
      const latestPostUri = firstRecord.uri;
      const parts = latestPostUri.slice(5).split('/');
      did = parts[0] || '';
      collection = parts[1] || '';
      rkey = parts[2] || '';
    } else {
      // Split at:// URI: at://did:plc:xxx/collection/recordkey
      const uriWithoutProtocol = postUri.slice(5); // Remove "at://"
      const parts = uriWithoutProtocol.split('/');
      
      if (parts.length < 3) {
        throw new Error('Invalid AT Protocol URI structure');
      }
      
      did = parts[0] || ''; // did:plc:xxx
      collection = parts[1] || ''; // e.g., "app.bsky.feed.post"
      rkey = parts[2] || ''; // The record key
    }

    if (!collection || !rkey) {
      console.error('Failed to extract collection and rkey from URI:', postUri);
      throw new Error('Could not extract collection and record key from URI');
    }

    console.log('Parsed URI - DID:', did, 'Collection:', collection, 'RKey:', rkey);

    // Verify the DID matches the authenticated user
    if (did !== agent.session.did) {
      console.error('DID mismatch - URI DID:', did, 'Session DID:', agent.session.did);
      throw new Error('Post does not belong to authenticated user');
    }

    const response = await agent.com.atproto.repo.getRecord({
      repo: agent.session.did,
      collection: collection,
      rkey: rkey,
    });

    console.log('Successfully retrieved record:', response.data.uri);

    // The AT Protocol response structure has the record data in response.data.value
    const record = response.data.value as any;

    // Handle different record types
    if (collection === 'com.whtwnd.blog.entry') {
      // Whitewind blog entry
      const titleStr = record.title || 'Untitled Post';
      const bodyStr = preservedHtml || record.content || '';
      const dateVal = new Date(record.createdAt || Date.now());
      return {
        postid: String(postId),
        post_id: String(postId),
        title: titleStr,
        post_title: titleStr,
        description: bodyStr,
        post_content: bodyStr,
        dateCreated: dateVal,
        post_date: dateVal,
        post_date_gmt: dateVal,
        post_modified: dateVal,
        post_modified_gmt: dateVal,
        post_status: 'draft', // Mask as draft so Ulysses doesn't panic on sudden state transitions
        post_type: 'post',
        post_name: titleStr.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        post_author: '1',
        post_parent: '0',
        post_mime_type: '',
        post_password: '',
        post_excerpt: '',
        comment_status: 'closed',
        ping_status: 'closed',
        menu_order: 0,
        sticky: false,
        post_format: 'standard'
      };
    } else if (collection === 'pub.leaflet.document') {
      // Leaflet document
      let documentText = '';
      if (record.pages && Array.isArray(record.pages)) {
        for (const page of record.pages) {
          if (page.blocks && Array.isArray(page.blocks)) {
            for (const b of page.blocks) {
              if (b.block && b.block.plaintext) {
                documentText += b.block.plaintext + '\n\n';
              }
            }
          }
        }
      }
      const titleStr = record.title || 'Untitled Post';
      const bodyStr = preservedHtml || documentText.trim() || record.description || '';
      const dateVal = new Date(record.publishedAt || record.createdAt || Date.now());
      const base: any = {
        post_id: String(postId),
        post_title: titleStr,
        post_content: bodyStr,
        post_excerpt: '',
        post_status: 'draft',
        post_type: 'post',
        post_format: 'standard',
        post_name: titleStr.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        post_author: '1',
        post_date: dateVal,
        post_date_gmt: dateVal,
        post_modified: dateVal,
        post_modified_gmt: dateVal,
        post_parent: '0',
        post_mime_type: '',
        post_password: '',
        link: `${serverUrl}/?p=${postId}`,
        guid: `${serverUrl}/?p=${postId}`,
        menu_order: 0,
        comment_status: 'closed',
        ping_status: 'closed',
        sticky: false
      };
      console.log('Sending this strict map inside wp.getPost response natively:', JSON.stringify(base, null, 2));
      return base;
    } else {
      // Standard Bluesky post
      const titleStr = record.title || 'Untitled Post';
      const bodyStr = preservedHtml || record.text || '';
      const dateVal = new Date(record.createdAt || Date.now());
      const base: any = {
        post_id: String(postId),
        post_title: titleStr,
        post_content: bodyStr,
        post_excerpt: '',
        post_status: 'draft',
        post_type: 'post',
        post_format: 'standard',
        post_name: titleStr.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        post_author: '1',
        post_date: dateVal,
        post_date_gmt: dateVal,
        post_modified: dateVal,
        post_modified_gmt: dateVal,
        post_parent: '0',
        post_mime_type: '',
        post_password: '',
        link: `${serverUrl}/?p=${postId}`,
        guid: `${serverUrl}/?p=${postId}`,
        menu_order: 0,
        comment_status: 'closed',
        ping_status: 'closed',
        sticky: false
      };
      // Only include arrays if populated
      if (record.tags && record.tags.length > 0) {
        (base as any).categories = record.tags;
      }
      return base;
    }
  } catch (error) {
    console.error('Failed to retrieve post from Bluesky:', error);
    console.error('Error details:', {
      postId,
      handle,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      errorStack: error instanceof Error ? error.stack : undefined
    });
    throw new Error(`Failed to retrieve post: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function handleGetRecentPosts(params: any[]) {
  // For now, getting recent posts is mocked dynamically as an empty array 
  // Returning an error violently crashes MarsEdit sync architectures natively.
  return [];
}

async function handleGetUserBlogs(params: any[], serverUrl: string) {
  // Try to use the host from the caller context if possible, otherwise fallback
  // The WP iOS app and regular XMLRPC clients just need to see this mock blog
  return [{
    blogid: '1',
    blogName: 'AT Protocol Bridge',
    url: serverUrl,
    xmlrpc: `${serverUrl}/xmlrpc.php`,
    isAdmin: true
  }];
}

async function handleGetUserInfo(params: any[]) {
  const handle = params[1] as string;
  const username = handle.split('.')[0] || handle;
  
  return {
    userid: '1',
    user_id: '1',
    nickname: username,
    email: `${username}@bsky.social`,
    lastname: '',
    last_name: '',
    firstname: username,
    first_name: username,
    display_name: username,
    url: `https://bsky.social/profile/${handle}`,
    bio: 'AT Protocol bridge'
  };
}
