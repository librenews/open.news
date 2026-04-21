import { BskyAgent } from '@atproto/api';
import { insertMediaMapping } from '../db/queries/weblog.js';
import { isWhitewindLexicon, createWhitewindEntry, isLeafletLexicon } from './lexicons.js';
import { parseGutenbergToLeaflet } from './wp-parser.js';

interface BlueskyPost {
  title: string;
  body: string;
  tags?: string[];
  lexicon: string;
  keywords?: string | undefined;
  excerpt?: string | undefined;
}

export async function publishToBluesky(handle: string, appPassword: string, post: BlueskyPost) {
  if (!handle || !appPassword) {
    throw new Error('Handle and app password are required');
  }

  try {
    const agent = new BskyAgent({ service: 'https://bsky.social' });
    await agent.login({ identifier: handle, password: appPassword });

    if (!agent.session?.did) {
      throw new Error('Failed to authenticate with Bluesky');
    }

    const now = new Date().toISOString();

    // Check if content is long-form and needs to be split into a thread
    if (shouldCreateThread(post)) {
      return await publishAsThread(agent, post, now);
    } else {
      if (isLeafletLexicon(post.lexicon)) {
        console.log('Publishing Leaflet Document naturally without arbitrary publication containers.');
      }

      // Create single post
      const record = await createRecord(post, now, agent.session.did);
      
      console.log(`Publishing single post to collection: ${post.lexicon}`);
      console.log('Record:', JSON.stringify(record, null, 2));

      const result = await agent.com.atproto.repo.createRecord({
        repo: agent.session.did,
        collection: post.lexicon,
        record,
      });

      console.log('Successfully published post:', result.data.uri);
      return result.data.uri;
    }
  } catch (error) {
    console.error('Failed to publish to Bluesky:', error);
    if (error instanceof Error) {
      // Handle common authentication errors
      if (error.message.includes('Invalid identifier or password')) {
        throw new Error('Invalid Bluesky handle or app password');
      }
      throw error;
    }
    throw new Error('Unknown error occurred while publishing to Bluesky');
  }
}

function shouldCreateThread(post: BlueskyPost): boolean {
  // Whitewind entries handle long content natively, no threading needed
  if (isWhitewindLexicon(post.lexicon)) {
    return false;
  }
  
  // Leaflet documents handle long content natively, no threading needed
  if (isLeafletLexicon(post.lexicon)) {
    return false;
  }
  
  const maxLength = 280; // Conservative limit
  const fullText = post.title ? `${post.title}\n\n${post.body}` : post.body;
  return fullText.length > maxLength;
}

async function publishAsThread(agent: BskyAgent, post: BlueskyPost, createdAt: string): Promise<string> {
  const maxLength = 280;
  const fullText = post.title ? `${post.title}\n\n${post.body}` : post.body;
  
  // Split text into thread posts
  const threadPosts = splitTextIntoThread(fullText, maxLength);
  
  console.log(`Publishing as thread with ${threadPosts.length} posts`);
  
  let parentRef: { uri: string; cid: string } | undefined;
  let rootRef: { uri: string; cid: string } | undefined;
  let firstPostUri = '';

  for (let i = 0; i < threadPosts.length; i++) {
    const text = threadPosts[i];
    
    const record: any = {
      text: text,
      createdAt,
      $type: 'app.bsky.feed.post'
    };

    // Add reply reference for thread posts after the first
    if (parentRef && rootRef) {
      record.reply = {
        root: rootRef,
        parent: parentRef
      };
    }

    const result = await agent.com.atproto.repo.createRecord({
      repo: agent.session!.did,
      collection: post.lexicon,
      record,
    });

    // Set references for subsequent posts
    const currentRef = { uri: result.data.uri, cid: result.data.cid };
    
    if (i === 0) {
      firstPostUri = result.data.uri;
      rootRef = currentRef;
    }
    
    parentRef = currentRef;
    
    console.log(`Published thread post ${i + 1}/${threadPosts.length}: ${result.data.uri}`);
    
    // Small delay between posts to avoid rate limiting
    if (i < threadPosts.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return firstPostUri; // Return the first post URI as the main post ID
}

function splitTextIntoThread(text: string, maxLength: number): string[] {
  const posts: string[] = [];
  const words = text.split(' ');
  let currentPost = '';
  
  for (const word of words) {
    const testPost = currentPost ? `${currentPost} ${word}` : word;
    
    if (testPost.length <= maxLength) {
      currentPost = testPost;
    } else {
      if (currentPost) {
        posts.push(currentPost);
        currentPost = word;
      } else {
        // Single word is longer than max length, truncate it
        posts.push(word.substring(0, maxLength - 3) + '...');
        currentPost = '';
      }
    }
  }
  
  if (currentPost) {
    posts.push(currentPost);
  }
  
  // Add thread indicators
  return posts.map((post, index) => {
    if (posts.length > 1) {
      return `${post} (${index + 1}/${posts.length})`;
    }
    return post;
  });
}

async function createRecord(post: BlueskyPost, createdAt: string, did: string): Promise<any> {
  // Handle Whitewind blog entries
  if (isWhitewindLexicon(post.lexicon)) {
    return createWhitewindEntry(post.title, post.body, post.excerpt);
  }

  // Handle Leaflet blog entries
  if (isLeafletLexicon(post.lexicon)) {
    return await parseGutenbergToLeaflet(post.body || '', post.title || 'Untitled', did);
  }

  // Handle standard Bluesky posts
  const maxLength = 300; // Bluesky character limit
  
  // Handle long content by truncating or splitting
  let text = post.body;
  let isLongForm = false;
  
  // If content is too long, truncate with ellipsis and title
  if (text.length > maxLength) {
    isLongForm = true;
    const availableSpace = maxLength - 3; // Reserve space for "..."
    
    // If there's a title, include it in the post
    if (post.title && post.title.trim()) {
      const titlePrefix = `${post.title}\n\n`;
      if (titlePrefix.length < availableSpace) {
        const remainingSpace = availableSpace - titlePrefix.length;
        text = titlePrefix + text.substring(0, remainingSpace) + "...";
      } else {
        // Title itself is too long, truncate it
        text = post.title.substring(0, availableSpace) + "...";
      }
    } else {
      text = text.substring(0, availableSpace) + "...";
    }
    
    console.warn(`Post content truncated from ${post.body.length} to ${text.length} characters`);
  } else if (post.title && post.title.trim()) {
    // For short posts, prepend title if it fits
    const withTitle = `${post.title}\n\n${text}`;
    if (withTitle.length <= maxLength) {
      text = withTitle;
    }
  }

  // Base record structure for standard Bluesky posts
  const baseRecord = {
    text: text,
    createdAt,
    $type: 'app.bsky.feed.post'
  };

  // Add facets for better formatting if title was included
  if (post.title && text.includes(post.title)) {
    // This could be enhanced with proper facet formatting for the title
  }

  return baseRecord;
}

export async function authenticateUser(handle: string, appPassword: string): Promise<boolean> {
  try {
    const agent = new BskyAgent({ service: 'https://bsky.social' });
    await agent.login({ identifier: handle, password: appPassword });
    return !!agent.session?.did;
} catch (error) {
    console.error('Authentication failed:', error);
    return false;
  }
}

export async function uploadMediaToBluesky(handle: string, appPassword: string, fileName: string, mimeType: string, fileBuffer: Uint8Array, serverUrl: string): Promise<{ url: string, mime: string, cid: string }> {
  if (!handle || !appPassword) {
    throw new Error('Handle and app password are required');
  }

  try {
    const agent = new BskyAgent({ service: 'https://bsky.social' });
    await agent.login({ identifier: handle, password: appPassword });

    if (!agent.session?.did) {
      throw new Error('Failed to authenticate with Bluesky');
    }

    console.log(`Uploading ${mimeType} media file to Bluesky PDS...`);
    const uploadRes = await agent.com.atproto.repo.uploadBlob(fileBuffer, {
      encoding: mimeType,
    });

    if (!uploadRes.success) {
      throw new Error('AT Protocol blob upload rejected natively');
    }

    const cid = uploadRes.data.blob.ref.toString();
    // Map to the public API sync blob URI directly on the PDS resolving orphaned blobs cleanly natively
    const genericUrl = `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=${agent.session.did}&cid=${cid}`;
    // MarsEdit absolutely demands `.jpg` or `.png` static file extensions inside its returned string physically!
    const proxyUrl = `${serverUrl}/m/${agent.session.did}/${cid}/media.jpg`;
    
    // Save mapping securely into db for structural extraction logically by upstream HTML converters recursively targeting physical metadata bytes natively
    try {
      await insertMediaMapping(proxyUrl, cid, uploadRes.data.blob.mimeType, fileBuffer.length);
    } catch (e) {
      console.warn('Failed to insert physical Blob cache natively natively:', e);
    }
    
    return {
      url: proxyUrl,
      mime: uploadRes.data.blob.mimeType,
      cid: cid
    };
  } catch (error) {
    console.error('Error uploading media to Bluesky:', error);
    throw error;
  }
}
