import { RichText } from '@atproto/api';

const text = "LLM code judges underperform humans by 12-23%. https://arxiv.org/abs/2603.24586";
const rt = new RichText({ text });
rt.detectFacetsWithoutResolution();

let out = '';
for (const segment of rt.segments()) {
  if (segment.isLink()) {
     out += `<a href="${segment.link?.uri}">${segment.text}</a>`;
  } else {
     out += segment.text;
  }
}
console.log(out);
