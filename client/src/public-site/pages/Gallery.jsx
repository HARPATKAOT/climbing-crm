import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';

const PHOTOS = [
  { file: 'gallery-01.jpg', category: 'field', label: 'טיפוס בשטח', alt: 'מטפס על מצוק טבעי עם חבל' },
  { file: 'gallery-16.jpg', category: 'field', label: 'טיפוס מצוקים', alt: 'מטפסת על מצוק מעל הים' },
  { file: 'gallery-09.jpg', category: 'field', label: 'יום מצוקים', alt: 'מטפס בנקיק סלע' },
  { file: 'gallery-11.jpg', category: 'field', label: 'מטיילים ומטפסים', alt: 'מטפס על סלע טבעי' },
  { file: 'gallery-04.jpg', category: 'events', label: 'יום הולדת בגובה', alt: 'שתי ילדות גולשות יחד ביום הולדת בקיר' },
  { file: 'gallery-12.jpg', category: 'events', label: 'חוגגים בקיר', alt: 'ילדות מחייכות בפעילות יום הולדת' },
  { file: 'gallery-19.jpg', category: 'events', label: 'אירוע על הקיר', alt: 'ילדים מטפסים באירוע על קיר בועז' },
  { file: 'gallery-02.jpg', category: 'wall', label: 'עבודת צוות', alt: 'ילדים ומדריך בפעילות חבל קבוצתית' },
  { file: 'gallery-03.jpg', category: 'wall', label: 'מתקדמים למעלה', alt: 'ילדה מטפסת על סולם חבלים' },
  { file: 'gallery-05.jpg', category: 'wall', label: 'חוגים בקיר', alt: 'ילדים משתפים פעולה במשיכת חבל' },
  { file: 'gallery-08.jpg', category: 'wall', label: 'מטפסות יחד', alt: 'שתי ילדות מטפסות על קיר צהוב' },
  { file: 'gallery-14.jpg', category: 'wall', label: 'טיפוס עצמאי', alt: 'מטפסת עם מכשיר אבטחה אוטומטי' },
];

const FILTERS = [
  { key: 'all', label: 'הכול' },
  { key: 'wall', label: 'בקיר' },
  { key: 'field', label: 'בשטח' },
  { key: 'events', label: 'חוגים ואירועים' },
];

export default function Gallery() {
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const visible = useMemo(() => filter === 'all' ? PHOTOS : PHOTOS.filter((photo) => photo.category === filter), [filter]);

  useEffect(() => {
    if (!selected) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') setSelected(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  return (
    <>
      <section
        className="ks-pagehero"
        style={{ backgroundImage: "linear-gradient(90deg, rgba(25,24,18,.18), rgba(25,24,18,.82)), url('/gallery/gallery-16.jpg')" }}
      >
        <div className="ks-wrap">
          <span className="ks-eyebrow">רגעים אמיתיים</span>
          <h1 className="ks-h1">מהקיר.<br />מהשטח. מהלב.</h1>
          <p className="ks-lede">ילדים, משפחות ומטיילים בתנועה — בלי תמונות מלאי ובלי הצגות.</p>
        </div>
      </section>

      <section className="ks-section">
        <div className="ks-wrap">
          <div className="ks-sectionhead">
            <div><span className="ks-eyebrow">הגלריה שלנו</span><h2 className="ks-h2">כל תמונה היא מסלול קטן</h2></div>
          </div>
          <div className="ks-filterbar" role="group" aria-label="סינון גלריה">
            {FILTERS.map((item) => (
              <button key={item.key} type="button" className={`ks-filter${filter === item.key ? ' is-active' : ''}`} onClick={() => setFilter(item.key)}>{item.label}</button>
            ))}
          </div>
          <div className="ks-gallery-grid">
            {visible.map((photo) => (
              <button className="ks-gallery-item" type="button" key={photo.file} onClick={() => setSelected(photo)} aria-label={`פתיחת תמונה: ${photo.label}`}>
                <img src={`/gallery/${photo.file}`} alt={photo.alt} loading="lazy" decoding="async" />
                <span>{photo.label}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {selected && (
        <div className="ks-lightbox" role="dialog" aria-modal="true" aria-label={selected.label} onClick={() => setSelected(null)}>
          <button className="ks-lightbox-close" type="button" aria-label="סגירת תמונה" onClick={() => setSelected(null)}><X /></button>
          <img src={`/gallery/${selected.file}`} alt={selected.alt} onClick={(event) => event.stopPropagation()} />
        </div>
      )}
    </>
  );
}
