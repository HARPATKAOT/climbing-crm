import React from 'react';
import manifest from '../galleryManifest.json';

/**
 * Photos carried over from the previous site. Lazy-loaded and never fetched on
 * the home page — most visitors arrive on a phone from a WhatsApp link.
 */
export default function Gallery() {
  return (
    <section className="ks-section">
      <div className="ks-wrap">
        <h1 className="ks-h1">גלריה</h1>
        <p className="ks-lede">רגעים מהקיר, מהחוגים ומהטיולים.</p>

        <div
          style={{
            display: 'grid',
            gap: 10,
            gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
          }}
        >
          {manifest.map((file) => (
            <img
              key={file}
              src={`/gallery/${file}`}
              alt=""
              loading="lazy"
              decoding="async"
              style={{
                width: '100%',
                aspectRatio: '4 / 3',
                objectFit: 'cover',
                borderRadius: 'var(--ks-radius)',
                border: '1px solid var(--ks-line)',
              }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
