import React from 'react';

const CHUNK_ERROR_PATTERN = /dynamically imported module|importing a module script failed|loading chunk|chunkloaderror/i;

export default class AppErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isChunkError = CHUNK_ERROR_PATTERN.test(String(error?.message || error));

    return (
      <div
        role="alert"
        dir="rtl"
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          background: '#0f111a',
          color: '#f3f4f6',
          fontFamily: 'Arial, sans-serif',
        }}
      >
        <div style={{ maxWidth: 440, textAlign: 'center' }}>
          <h1 style={{ margin: '0 0 12px', fontSize: 24 }}>
            {isChunkError ? 'המערכת התעדכנה' : 'לא הצלחנו לטעון את המסך'}
          </h1>
          <p style={{ margin: '0 0 20px', color: '#aeb4c0', lineHeight: 1.6 }}>
            {isChunkError
              ? 'נדרשת טעינה מחדש כדי לסנכרן את קבצי המערכת לגרסה האחרונה.'
              : 'אירעה שגיאה זמנית. טעינה מחדש אמורה להחזיר אותך לעבודה.'}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              border: 0,
              borderRadius: 8,
              padding: '10px 18px',
              background: '#38bdf8',
              color: '#07111a',
              fontSize: 15,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            טעינה מחדש
          </button>
        </div>
      </div>
    );
  }
}
