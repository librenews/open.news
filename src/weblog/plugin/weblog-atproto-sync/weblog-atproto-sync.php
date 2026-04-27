<?php
/**
 * Plugin Name: Weblog AT Protocol Sync
 * Description: Natively syndicates WordPress posts to the AT Protocol using the site.standard.document schema.
 * Version: 1.0.0
 * Author: Weblog.social
 * Text Domain: weblog-atproto-sync
 */

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly.
}

require_once plugin_dir_path(__FILE__) . 'api.php';
require_once plugin_dir_path(__FILE__) . 'parser.php';

class Weblog_ATProto_Sync {

    public function __construct() {
        add_action('admin_menu', [$this, 'add_settings_page']);
        add_action('admin_init', [$this, 'register_settings']);
        add_action('transition_post_status', [$this, 'sync_post_to_atproto'], 10, 3);
        add_action('wp_head', [$this, 'inject_site_standard_link']);
        add_action('init', [$this, 'add_well_known_rewrite']);
        add_action('template_redirect', [$this, 'handle_well_known_request']);
    }

    public function add_settings_page() {
        add_options_page(
            'AT Protocol Sync',
            'AT Protocol Sync',
            'manage_options',
            'weblog-atproto-sync',
            [$this, 'render_settings_page']
        );
    }

    public function register_settings() {
        register_setting('weblog_atproto_options', 'weblog_atproto_handle');
        register_setting('weblog_atproto_options', 'weblog_atproto_app_password');
        register_setting('weblog_atproto_options', 'weblog_atproto_did'); // Cached DID
    }

    public function render_settings_page() {
        ?>
        <div class="wrap">
            <h1>AT Protocol Sync Settings</h1>
            <p>Enter your Bluesky/AT Protocol handle and an App Password to natively syndicate your WordPress posts.</p>
            <form method="post" action="options.php">
                <?php settings_fields('weblog_atproto_options'); ?>
                <?php do_settings_sections('weblog_atproto_options'); ?>
                <table class="form-table">
                    <tr valign="top">
                        <th scope="row">Bluesky Handle</th>
                        <td><input type="text" name="weblog_atproto_handle" value="<?php echo esc_attr(get_option('weblog_atproto_handle')); ?>" placeholder="e.g. yourname.bsky.social" /></td>
                    </tr>
                    <tr valign="top">
                        <th scope="row">App Password</th>
                        <td><input type="password" name="weblog_atproto_app_password" value="<?php echo esc_attr(get_option('weblog_atproto_app_password')); ?>" placeholder="xxxx-xxxx-xxxx-xxxx" /></td>
                    </tr>
                </table>
                <?php submit_button(); ?>
            </form>
        </div>
        <?php
    }

    public function sync_post_to_atproto($new_status, $old_status, $post) {
        if ($new_status !== 'publish' || $old_status === 'publish') {
            return; // Only sync on new publish
        }

        if ($post->post_type !== 'post') {
            return;
        }

        $handle = get_option('weblog_atproto_handle');
        $app_password = get_option('weblog_atproto_app_password');

        if (empty($handle) || empty($app_password)) {
            return;
        }

        $api = new Weblog_ATProto_API($handle, $app_password);
        $session = $api->create_session();

        if (is_wp_error($session)) {
            error_log('AT Protocol Sync Error: ' . $session->get_error_message());
            return;
        }

        $did = $session['did'];
        $access_jwt = $session['accessJwt'];

        // Save DID for well-known route
        update_option('weblog_atproto_did', $did);

        // Generate a pseudo-random base36 string for rkey
        $rkey = substr(base_convert(md5(uniqid()), 16, 36), 0, 13);
        
        $record = Weblog_ATProto_Parser::parse_post_to_standard_site($post, $did, $rkey, $api, $access_jwt);

        $result = $api->create_record($did, $access_jwt, 'site.standard.document', $rkey, $record);

        if (is_wp_error($result)) {
            error_log('AT Protocol Sync Error (Record Creation): ' . $result->get_error_message());
        } else {
            // Save the AT URI so we can inject it into the head
            update_post_meta($post->ID, '_weblog_atproto_uri', $result['uri']);
        }
    }

    public function inject_site_standard_link() {
        if (is_single()) {
            global $post;
            $at_uri = get_post_meta($post->ID, '_weblog_atproto_uri', true);
            if ($at_uri) {
                echo '<link rel="site.standard.document" href="' . esc_url($at_uri) . '">' . "\n";
            }
        }
    }

    public function add_well_known_rewrite() {
        add_rewrite_rule('^\.well-known/site\.standard\.publication/?', 'index.php?weblog_atproto_well_known=1', 'top');
    }

    public function handle_well_known_request() {
        global $wp;
        // Check if the query var exists (we use a hacky REQUEST URI check here since we didn't register the query var)
        if (strpos($_SERVER['REQUEST_URI'], '.well-known/site.standard.publication') !== false) {
            $did = get_option('weblog_atproto_did');
            if ($did) {
                header('Content-Type: text/plain');
                // The AT-URI of the publication record (if we had one, but returning the DID or a generic publication rkey is standard)
                // For MVP, standard.site expects the AT-URI of the site.standard.publication record.
                // If we don't create one, returning the DID as at://did:plc:.../site.standard.publication/self is a fallback.
                echo "at://" . $did . "/site.standard.publication/self";
                exit;
            }
        }
    }
}

new Weblog_ATProto_Sync();
