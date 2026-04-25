import { parse } from '@wordpress/block-serialization-default-parser';
const ast = parse('<!-- wp:list {"ordered":true} --><ol class="wp-block-list"><!-- wp:list-item --><li>A</li><!-- /wp:list-item --></ol><!-- /wp:list -->');
console.log(JSON.stringify(ast, null, 2));
