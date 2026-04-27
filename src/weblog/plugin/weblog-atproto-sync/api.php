<?php
if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly.
}

class Weblog_ATProto_API {
    private $pds_url;
    private $identifier;
    private $password;

    public function __construct($identifier, $password, $pds_url = 'https://bsky.social') {
        $this->identifier = $identifier;
        $this->password = $password;
        $this->pds_url = rtrim($pds_url, '/');
    }

    public function create_session() {
        $url = $this->pds_url . '/xrpc/com.atproto.server.createSession';
        
        $body = json_encode([
            'identifier' => $this->identifier,
            'password'   => $this->password
        ]);

        $response = wp_remote_post($url, [
            'headers' => [
                'Content-Type' => 'application/json',
            ],
            'body' => $body,
            'timeout' => 15,
        ]);

        if (is_wp_error($response)) {
            return new WP_Error('api_error', $response->get_error_message());
        }

        $code = wp_remote_retrieve_response_code($response);
        $body = wp_remote_retrieve_body($response);
        $data = json_decode($body, true);

        if ($code !== 200) {
            return new WP_Error('api_error', isset($data['message']) ? $data['message'] : 'Failed to create session');
        }

        return $data;
    }

    public function create_record($did, $access_jwt, $collection, $rkey, $record) {
        $url = $this->pds_url . '/xrpc/com.atproto.repo.createRecord';

        $body = json_encode([
            'repo' => $did,
            'collection' => $collection,
            'rkey' => $rkey,
            'record' => $record
        ]);

        $response = wp_remote_post($url, [
            'headers' => [
                'Content-Type' => 'application/json',
                'Authorization' => 'Bearer ' . $access_jwt
            ],
            'body' => $body,
            'timeout' => 15,
        ]);

        if (is_wp_error($response)) {
            return new WP_Error('api_error', $response->get_error_message());
        }

        $code = wp_remote_retrieve_response_code($response);
        $body = wp_remote_retrieve_body($response);
        $data = json_decode($body, true);

        if ($code !== 200) {
            return new WP_Error('api_error', isset($data['message']) ? $data['message'] : 'Failed to create record');
        }

        return $data;
    }

    public function upload_blob($access_jwt, $file_url) {
        $response = wp_remote_get($file_url, ['timeout' => 15]);
        if (is_wp_error($response)) {
            return $response;
        }

        $body = wp_remote_retrieve_body($response);
        $content_type = wp_remote_retrieve_header($response, 'content-type');
        if (empty($content_type)) {
            $content_type = 'application/octet-stream';
        }

        if (strlen($body) > 976562) { // roughly 1MB limit for AT Protocol blobs natively without chunking
            // We should try to compress or just fail gracefully. For now, we will just send it and let PDS reject if it's too large.
            // PDS limit is 976.56 KB (1000000 bytes)
            if (strlen($body) > 1000000) {
                return new WP_Error('api_error', 'Image exceeds 1MB AT Protocol limit');
            }
        }

        $url = $this->pds_url . '/xrpc/com.atproto.repo.uploadBlob';
        $upload_response = wp_remote_post($url, [
            'headers' => [
                'Content-Type' => $content_type,
                'Authorization' => 'Bearer ' . $access_jwt
            ],
            'body' => $body,
            'timeout' => 30,
        ]);

        if (is_wp_error($upload_response)) {
            return $upload_response;
        }

        $code = wp_remote_retrieve_response_code($upload_response);
        $res_body = wp_remote_retrieve_body($upload_response);
        $data = json_decode($res_body, true);

        if ($code !== 200) {
            return new WP_Error('api_error', isset($data['message']) ? $data['message'] : 'Failed to upload blob');
        }

        return $data;
    }
}
