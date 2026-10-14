'use client';

import { useMemo } from 'react';
import { buildOutlineTree } from '../lib/headings';

function OutlineNode({ node }) {
  const level = Math.min(6, Math.max(1, node.level || 1));
  return (
    <li className={`lvl-${level}`}>
      <span className="outline__title">
        <span>{node.title}</span>
        {node.source === 'heuristic' ? <span className="tag">حدسی</span> : null}
      </span>
      {node.children.length ? (
        <ul>
          {node.children.map((child) => (
            <OutlineNode key={child.id} node={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** نمایش فهرست تودرتوی سرفصل‌ها */
export default function OutlineView({ headings }) {
  const tree = useMemo(() => buildOutlineTree(headings), [headings]);

  if (!headings?.length) {
    return (
      <p className="alert alert--warn" style={{ marginTop: 0 }}>
        هیچ سرفصلی پیدا نشد. اگر فایل اسکن‌شده (تصویری) است، اول باید OCR شود. در فایل‌های Word هم
        بهتر است سرفصل‌ها با سبک <b>Heading 1/2/3</b> نوشته شده باشند. در هر صورت می‌توانید متن
        Markdown را در تب بعدی دستی ویرایش کنید و روی «به‌روزرسانی سرفصل‌ها» بزنید.
      </p>
    );
  }

  const levels = headings.reduce((acc, item) => {
    acc[item.level] = (acc[item.level] || 0) + 1;
    return acc;
  }, {});
  const breakdown = Object.keys(levels)
    .map(Number)
    .sort((a, b) => a - b)
    .map((level) => `سطح ${level}: ${levels[level].toLocaleString('fa-IR')}`)
    .join('  |  ');

  return (
    <div className="outline">
      <p className="card__hint">
        <b>{headings.length.toLocaleString('fa-IR')}</b> سرفصل شناسایی شد
        {breakdown ? ` (${breakdown})` : ''}.
      </p>
      <ul>
        {tree.map((node) => (
          <OutlineNode key={node.id} node={node} />
        ))}
      </ul>
    </div>
  );
}
