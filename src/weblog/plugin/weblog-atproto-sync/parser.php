<?php
if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly.
}

class Weblog_ATProto_Parser {

    public static function parse_post_to_standard_site($post, $did, $rkey, $api = null, $access_jwt = null) {
        $blocks = parse_blocks($post->post_content);
        $leaflet_blocks = [];

        foreach ($blocks as $block) {
            if (empty($block['blockName'])) {
                if (trim(strip_tags($block['innerHTML'])) !== '') {
                    $leaflet_blocks[] = self::create_text_block($block['innerHTML']);
                }
                continue;
            }

            switch ($block['blockName']) {
                case 'core/paragraph':
                    $leaflet_blocks[] = self::create_text_block($block['innerHTML']);
                    break;
                case 'core/heading':
                    $level = isset($block['attrs']['level']) ? $block['attrs']['level'] : 2;
                    $leaflet_blocks[] = self::create_heading_block($block['innerHTML'], $level);
                    break;
                case 'core/quote':
                    $leaflet_blocks[] = self::create_blockquote_block($block['innerHTML']);
                    break;
                case 'core/list':
                    $list_blocks = self::parse_list_block($block['innerHTML']);
                    foreach ($list_blocks as $lb) {
                        $leaflet_blocks[] = $lb;
                    }
                    break;
                case 'core/code':
                case 'core/preformatted':
                    $language = 'plaintext';
                    if (preg_match('/class=["\'][^"\']*language-([a-zA-Z0-9-]+)[^"\']*["\']/i', $block['innerHTML'], $matches)) {
                        $language = $matches[1];
                    }
                    $leaflet_blocks[] = self::create_code_block($block['innerHTML'], $language);
                    break;
                case 'core/embed':
                    $url = isset($block['attrs']['url']) ? $block['attrs']['url'] : '';
                    if (empty($url) && preg_match('/src=["\']([^"\']+)["\']/', $block['innerHTML'], $matches)) {
                        $url = $matches[1];
                    }
                    if (empty($url)) {
                        $url = trim(strip_tags($block['innerHTML']));
                    }
                    
                    if (strpos($url, 'youtube.com') !== false || strpos($url, 'youtu.be') !== false) {
                        preg_match('/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/i', $url, $matches);
                        if (!empty($matches[1])) {
                            $leaflet_blocks[] = self::create_iframe_block('https://www.youtube.com/embed/' . $matches[1]);
                        } else {
                            $leaflet_blocks[] = self::create_website_block($url);
                        }
                    } else {
                        $leaflet_blocks[] = self::create_website_block($url);
                    }
                    break;
                case 'core/image':
                    preg_match('/src="([^"]+)"/', $block['innerHTML'], $matches);
                    if (!empty($matches[1])) {
                        $img_url = $matches[1];
                        if ($api && $access_jwt) {
                            $blob_res = $api->upload_blob($access_jwt, $img_url);
                            if (!is_wp_error($blob_res) && isset($blob_res['blob'])) {
                                $leaflet_blocks[] = self::create_image_block($blob_res['blob']);
                            } else {
                                $leaflet_blocks[] = self::create_website_block($img_url);
                            }
                        } else {
                            $leaflet_blocks[] = self::create_website_block($img_url);
                        }
                    }
                    break;
                default:
                    if (!empty($block['innerHTML']) && trim(strip_tags($block['innerHTML'])) !== '') {
                        $leaflet_blocks[] = self::create_text_block($block['innerHTML']);
                    }
                    break;
            }
        }

        $site_url = get_site_url();
        $record = [
            '$type' => 'site.standard.document',
            'title' => get_the_title($post->ID) ?: 'Untitled',
            'description' => '',
            'tags' => [],
            'site' => $site_url,
            'path' => '/' . $rkey,
            'author' => $did,
            'publishedAt' => gmdate('Y-m-d\TH:i:s\Z', strtotime($post->post_date_gmt)),
            'content' => [
                '$type' => 'pub.leaflet.content',
                'pages' => [
                    [
                        'id' => wp_generate_uuid4(),
                        '$type' => 'pub.leaflet.pages.linearDocument',
                        'blocks' => $leaflet_blocks
                    ]
                ]
            ]
        ];

        return $record;
    }

    private static function parse_rich_text($html) {
        if (empty($html)) return ['plaintext' => '', 'facets' => []];

        $plaintext = '';
        $facets = [];
        $open_tags = [];
        
        $regex = '/<(?:(\/)?(strong|b|em|i|a)|a\s+[^>]*href=["\']([^"\']+)["\'][^>]*)>/i';
        
        $last_index = 0;
        
        if (preg_match_all($regex, $html, $matches, PREG_OFFSET_CAPTURE | PREG_SET_ORDER)) {
            foreach ($matches as $match) {
                $match_text = $match[0][0];
                $match_index = $match[0][1];
                
                if ($match_index > $last_index) {
                    $plaintext .= strip_tags(substr($html, $last_index, $match_index - $last_index));
                }
                
                $is_closing = !empty($match[1][0]);
                $raw_tag = strtolower(!empty($match[2][0]) ? $match[2][0] : 'a');
                $href = !empty($match[3][0]) ? $match[3][0] : null;
                
                $current_byte_length = strlen($plaintext); // strlen in PHP returns byte length natively
                
                if ($is_closing) {
                    $last_match_idx = -1;
                    for ($i = count($open_tags) - 1; $i >= 0; $i--) {
                        $t = $open_tags[$i]['type'];
                        if ($t === $raw_tag || 
                           ($raw_tag === 'b' && $t === 'strong') || ($raw_tag === 'strong' && $t === 'b') ||
                           ($raw_tag === 'i' && $t === 'em') || ($raw_tag === 'em' && $t === 'i')) {
                            $last_match_idx = $i;
                            break;
                        }
                    }
                    
                    if ($last_match_idx !== -1) {
                        $opened = array_splice($open_tags, $last_match_idx, 1)[0];
                        if ($opened && $opened['byteStart'] < $current_byte_length) {
                            if ($opened['type'] === 'strong' || $opened['type'] === 'b') {
                                $facets[] = [
                                    'index' => ['byteStart' => $opened['byteStart'], 'byteEnd' => $current_byte_length],
                                    'features' => [['$type' => 'pub.leaflet.richtext.facet#bold']]
                                ];
                            } else if ($opened['type'] === 'em' || $opened['type'] === 'i') {
                                $facets[] = [
                                    'index' => ['byteStart' => $opened['byteStart'], 'byteEnd' => $current_byte_length],
                                    'features' => [['$type' => 'pub.leaflet.richtext.facet#italic']]
                                ];
                            } else if ($opened['type'] === 'a' && !empty($opened['uri'])) {
                                $facets[] = [
                                    'index' => ['byteStart' => $opened['byteStart'], 'byteEnd' => $current_byte_length],
                                    'features' => [['$type' => 'app.bsky.richtext.facet#link', 'uri' => $opened['uri']]]
                                ];
                            }
                        }
                    }
                } else {
                    $open_tags[] = [
                        'type' => $raw_tag,
                        'byteStart' => $current_byte_length,
                        'uri' => $href
                    ];
                }
                
                $last_index = $match_index + strlen($match_text);
            }
        }
        
        if ($last_index < strlen($html)) {
            $plaintext .= strip_tags(substr($html, $last_index));
        }
        
        // Handle whitespace trimming correctly by adjusting byte offsets
        $ltrim_plaintext = ltrim($plaintext);
        $leading_bytes = strlen($plaintext) - strlen($ltrim_plaintext);
        $trimmed = trim($plaintext);
        $final_byte_length = strlen($trimmed);
        
        if ($leading_bytes > 0) {
            foreach ($facets as &$facet) {
                $facet['index']['byteStart'] = max(0, $facet['index']['byteStart'] - $leading_bytes);
                $facet['index']['byteEnd'] = max(0, $facet['index']['byteEnd'] - $leading_bytes);
            }
        }
        
        foreach ($facets as &$facet) {
            $facet['index']['byteEnd'] = min($facet['index']['byteEnd'], $final_byte_length);
            $facet['index']['byteStart'] = min($facet['index']['byteStart'], $final_byte_length);
        }
        
        // Filter collapsed facets
        $valid_facets = array_filter($facets, function($f) {
            return $f['index']['byteStart'] < $f['index']['byteEnd'];
        });
        
        return ['plaintext' => $trimmed, 'facets' => array_values($valid_facets)];
    }

    private static function create_text_block($html) {
        $parsed = self::parse_rich_text($html);
        return [
            '$type' => 'pub.leaflet.pages.linearDocument#block',
            'block' => [
                '$type' => 'pub.leaflet.blocks.text',
                'plaintext' => $parsed['plaintext'],
                'facets' => $parsed['facets']
            ]
        ];
    }

    private static function create_heading_block($html, $level) {
        $parsed = self::parse_rich_text($html);
        return [
            '$type' => 'pub.leaflet.pages.linearDocument#block',
            'block' => [
                '$type' => 'pub.leaflet.blocks.header',
                'plaintext' => $parsed['plaintext'],
                'level' => (int)$level,
                'facets' => $parsed['facets']
            ]
        ];
    }

    private static function create_blockquote_block($html) {
        $parsed = self::parse_rich_text($html);
        return [
            '$type' => 'pub.leaflet.pages.linearDocument#block',
            'block' => [
                '$type' => 'pub.leaflet.blocks.blockquote',
                'plaintext' => $parsed['plaintext'],
                'facets' => $parsed['facets']
            ]
        ];
    }

    private static function parse_list_block($html) {
        $blocks = [];
        if (preg_match_all('/<li[^>]*>(.*?)<\/li>/is', $html, $matches)) {
            $is_ordered = strpos($html, '<ol') !== false;
            foreach ($matches[1] as $index => $li_html) {
                $prefix = $is_ordered ? ($index + 1) . '. ' : '• ';
                // Prepend the prefix to the inner html text cleanly.
                $li_html_prefixed = $prefix . strip_tags($li_html, '<b><strong><i><em><a>');
                $parsed = self::parse_rich_text($li_html_prefixed);
                $blocks[] = [
                    '$type' => 'pub.leaflet.pages.linearDocument#block',
                    'block' => [
                        '$type' => 'pub.leaflet.blocks.text',
                        'plaintext' => $parsed['plaintext'],
                        'facets' => $parsed['facets']
                    ]
                ];
            }
        }
        return $blocks;
    }

    private static function create_code_block($html, $language) {
        return [
            '$type' => 'pub.leaflet.pages.linearDocument#block',
            'block' => [
                '$type' => 'pub.leaflet.blocks.code',
                'plaintext' => trim(strip_tags($html)),
                'language' => $language
            ]
        ];
    }

    private static function create_iframe_block($url) {
        return [
            '$type' => 'pub.leaflet.pages.linearDocument#block',
            'block' => [
                '$type' => 'pub.leaflet.blocks.iframe',
                'url' => $url,
                'aspectRatio' => ['width' => 16, 'height' => 9]
            ]
        ];
    }

    private static function create_website_block($url) {
        return [
            '$type' => 'pub.leaflet.pages.linearDocument#block',
            'block' => [
                '$type' => 'pub.leaflet.blocks.website',
                'url' => $url
            ]
        ];
    }

    private static function create_image_block($blob) {
        return [
            '$type' => 'pub.leaflet.pages.linearDocument#block',
            'block' => [
                '$type' => 'pub.leaflet.blocks.image',
                'image' => $blob,
                'alt' => ''
            ]
        ];
    }
}
