import { Marp } from '@marp-team/marp-core';
import container from 'markdown-it-container';

// Lets slides use `::: class names` ... `:::` instead of raw <div> tags.
// Nest by giving the outer fence more colons (e.g. `::::` around `:::`).
export default {
  themeSet: './themes',
  html: true,
  allowLocalFiles: true,
  engine: (opts) =>
    new Marp(opts).use((md) =>
      md.use(container, 'div', {
        marker: ':',
        validate: (params) => params.trim().length > 0,
        render: (tokens, idx) =>
          tokens[idx].nesting === 1
            ? `<div class="${md.utils.escapeHtml(tokens[idx].info.trim())}">\n`
            : '</div>\n',
      }),
    ),
};
