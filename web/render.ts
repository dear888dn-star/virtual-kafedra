import { parseMarkdown, type Block, type Inline } from '../src/shared/markdown';

function inline(nodes: Inline[]): Node[] {
  return nodes.map((n): Node => {
    switch (n.t) {
      case 'text':
        return document.createTextNode(n.v);
      case 'code': {
        const el = document.createElement('code');
        el.textContent = n.v;
        return el;
      }
      case 'strong':
      case 'em': {
        const el = document.createElement(n.t);
        el.append(...inline(n.c));
        return el;
      }
      case 'link': {
        const a = document.createElement('a');
        a.href = n.href; // parser faqat http(s) ga ruxsat beradi
        a.target = '_blank';
        a.rel = 'noopener noreferrer nofollow';
        a.append(...inline(n.c));
        return a;
      }
    }
  });
}

function block(b: Block): Node {
  switch (b.t) {
    case 'h': {
      const el = document.createElement(`h${Math.min(6, b.level + 1)}` as 'h2');
      el.append(...inline(b.c));
      return el;
    }
    case 'p': {
      const el = document.createElement('p');
      el.append(...inline(b.c));
      return el;
    }
    case 'list': {
      const el = document.createElement(b.ordered ? 'ol' : 'ul');
      for (const it of b.items) {
        const li = document.createElement('li');
        li.append(...inline(it));
        el.append(li);
      }
      return el;
    }
    case 'code': {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = b.v;
      pre.append(code);
      return pre;
    }
    case 'quote': {
      const el = document.createElement('blockquote');
      el.append(...b.c.map(block));
      return el;
    }
    case 'hr':
      return document.createElement('hr');
    case 'table': {
      const t = document.createElement('table');
      const head = document.createElement('thead');
      const hr = document.createElement('tr');
      for (const c of b.head) {
        const th = document.createElement('th');
        th.append(...inline(c));
        hr.append(th);
      }
      head.append(hr);
      const body = document.createElement('tbody');
      for (const r of b.rows) {
        const tr = document.createElement('tr');
        for (const c of r) {
          const td = document.createElement('td');
          td.append(...inline(c));
          tr.append(td);
        }
        body.append(tr);
      }
      t.append(head, body);
      return t;
    }
  }
}

/** Markdown'ni xavfsiz DOM daraxtiga aylantiradi (innerHTML ishlatilmaydi). */
export function renderMarkdown(md: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  frag.append(...parseMarkdown(md).map(block));
  return frag;
}
