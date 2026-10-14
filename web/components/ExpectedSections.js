'use client';

import { DOC_TYPES, allTitles } from '../lib/sections';

/**
 * جعبه‌های انتخاب «بخش‌های مورد انتظار» — پیش از تحلیل به کاربر نشان داده می‌شود
 * تا خودش تعیین کند داور کدام سرفصل‌ها را بررسی کند.
 */
export default function ExpectedSections({
  docType,
  groups,
  selection,
  disabled = false,
  onDocTypeChange,
  onToggle,
  onSetSelection,
}) {
  const groupsSafe = Array.isArray(groups) ? groups : [];
  const selected = new Set(Array.isArray(selection) ? selection : []);
  const all = allTitles(groupsSafe);
  const chosen = all.filter((title) => selected.has(title)).length;

  const setGroup = (group, checked) => {
    const next = new Set(selected);
    for (const item of group?.items || []) {
      if (checked) next.add(item.title);
      else next.delete(item.title);
    }
    onSetSelection(Array.from(next));
  };

  return (
    <section className="card">
      <div className="card__head">
        <h2>۲) بخش‌های مورد انتظار</h2>
        <p className="card__hint">
          {chosen} مورد از {all.length} مورد انتخاب شده است — داور برای هر مورد می‌گوید «موجود»، «ناقص» یا «غایب».
        </p>
      </div>

      <div className="tabs" style={{ marginTop: 0 }}>
        {DOC_TYPES.map((type) => (
          <button
            key={type.id}
            type="button"
            className={`tab${docType === type.id ? ' tab--active' : ''}`}
            onClick={() => onDocTypeChange(type.id)}
            disabled={disabled}
          >
            {type.icon} {type.label}
          </button>
        ))}
      </div>

      <div className="actions" style={{ marginTop: 0, marginBottom: 14 }}>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => onSetSelection(all)}
          disabled={disabled}
        >
          انتخاب همه
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => onSetSelection([])}
          disabled={disabled}
        >
          حذف همه
        </button>
        <span className="badge">{chosen ? `${chosen} سرفصل برای داوری` : 'هیچ سرفصلی انتخاب نشده'}</span>
      </div>

      <div className="boxes">
        {groupsSafe.map((group) => {
          const titles = (group.items || []).map((item) => item.title);
          const groupChosen = titles.filter((title) => selected.has(title)).length;
          return (
            <div className="box" key={group.id || group.title}>
              <div className="box__head">
                <b>{group.title}</b>
                <span className="muted">
                  {groupChosen} از {titles.length}
                </span>
                <button
                  type="button"
                  className="linkbtn"
                  disabled={disabled}
                  onClick={() => setGroup(group, groupChosen !== titles.length)}
                >
                  {groupChosen === titles.length ? 'حذف این گروه' : 'انتخاب این گروه'}
                </button>
              </div>
              <div className="checks">
                {titles.map((title) => (
                  <label key={title} className={`check${selected.has(title) ? ' check--on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={selected.has(title)}
                      disabled={disabled}
                      onChange={() => onToggle(title)}
                    />
                    <span>{title}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <p className="card__hint" style={{ marginTop: 14 }}>
        این فهرست‌ها در «پنل ← سرفصل‌های پیش‌فرض» قابل ویرایش‌اند و نتیجه‌ی بررسی آن‌ها در گزارش نهایی نمایش
        داده می‌شود.
      </p>
    </section>
  );
}
