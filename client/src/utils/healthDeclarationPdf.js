import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

const DEFAULT_QUESTIONS = {
  q1: 'האם המתאמן סובל מאסתמה, קוצר נשימה או מחלת ריאות?',
  q2: 'האם המתאמן סובל מבעיות לב, לחץ דם, או סחרחורות/התעלפויות?',
  q3: 'האם יש בעיה אורתופדית (גב, פרקים, שברים) המגבילה פעילות מאומצת?',
  q4: 'האם יש מגבלה רפואית שדורשת תשומת לב מיוחדת ביציאה לשטח?',
  q5: 'האם הילד/ה נוטל/ת תרופות קבועות?',
  q6: 'האם הילד/ה חווה כאבים, עייפות חריגה, או קושי בנשימה במאמץ פיזי?',
  q7: 'האם ישנה רגישות לחגורות או ציוד מתכת?',
};

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function answerRows(answers = {}, questionLabels = {}) {
  const keys = Object.keys(answers);
  if (!keys.length) {
    return '<div class="muted">לא נרשמו תשובות לשאלון הרפואי</div>';
  }
  return keys.map((id) => {
    const yes = !!answers[id];
    const label = questionLabels[id] || DEFAULT_QUESTIONS[id] || id;
    return `
      <div class="qa ${yes ? 'yes' : 'no'}">
        <span class="mark">${yes ? 'כן' : 'לא'}</span>
        <span>${escapeHtml(label)}</span>
      </div>`;
  }).join('');
}

async function resolveWaiverAndQuestions(decl) {
  let waiverText = '';
  const questionLabels = { ...DEFAULT_QUESTIONS };
  const slug = decl.templateSlug || decl.template_slug;
  if (!slug) {
    return { waiverText, questionLabels };
  }
  try {
    const res = await fetch(`/api/public/form-templates/${encodeURIComponent(slug)}`);
    if (res.ok) {
      const t = await res.json();
      waiverText = t.waiverText || '';
      (t.healthQuestions || []).forEach((q) => {
        if (q?.id && q?.label) questionLabels[q.id] = q.label;
      });
    }
  } catch {
    // keep defaults
  }
  return { waiverText, questionLabels };
}

function buildCertificateHtml(decl, { waiverText, questionLabels }) {
  const parentName = decl.parentName || decl.signedBy || '—';
  const climberName = decl.climberName || decl.studentName || '—';
  const phone = decl.phone || decl.emergencyPhone || '—';
  const date = decl.signedDate || decl.date || '—';
  const parentId = decl.parentIdNum || '—';
  const climberId = decl.climberIdNum || '—';
  const birthDate = decl.birthDate || '—';
  const signature = decl.signature_url || decl.signature || '';
  const hasSig = typeof signature === 'string' && signature.startsWith('data:image');
  const title = decl.title || 'הצהרת בריאות + הסרת אחריות — אישור חתום';
  const templateNote = decl.templateSlug ? `תבנית: ${decl.templateSlug}` : '';

  return `
    <div id="hd-cert-root" dir="rtl" style="
      width: 794px; min-height: 1123px; box-sizing: border-box;
      padding: 40px 44px; background: #fff; color: #111;
      font-family: 'Segoe UI', Tahoma, Arial, sans-serif; text-align: right;
    ">
      <style>
        #hd-cert-root h1 { margin: 0 0 6px; font-size: 22px; color: #0f172a; }
        #hd-cert-root .sub { margin: 0 0 18px; font-size: 13px; color: #64748b; }
        #hd-cert-root .brand {
          display: flex; justify-content: space-between; align-items: flex-start;
          border-bottom: 2px solid #f97316; padding-bottom: 14px; margin-bottom: 18px;
        }
        #hd-cert-root .badge {
          background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0;
          font-size: 12px; font-weight: 700; padding: 6px 10px; border-radius: 999px;
        }
        #hd-cert-root .grid {
          display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; margin-bottom: 18px;
        }
        #hd-cert-root .field {
          background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px;
        }
        #hd-cert-root .label { font-size: 11px; color: #64748b; margin-bottom: 4px; }
        #hd-cert-root .value { font-size: 14px; font-weight: 700; color: #0f172a; }
        #hd-cert-root h2 { font-size: 15px; margin: 18px 0 10px; color: #ea580c; }
        #hd-cert-root .qa {
          display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px;
          border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 6px; font-size: 12px;
        }
        #hd-cert-root .qa.yes { background: #fef2f2; border-color: #fecaca; }
        #hd-cert-root .qa.no { background: #f8fafc; }
        #hd-cert-root .mark {
          font-weight: 800; min-width: 28px; color: #0f172a;
        }
        #hd-cert-root .qa.yes .mark { color: #b91c1c; }
        #hd-cert-root .waiver {
          white-space: pre-wrap; font-size: 11px; line-height: 1.55; color: #334155;
          background: #fff7ed; border: 1px solid #fed7aa; border-radius: 10px; padding: 12px;
          max-height: 220px; overflow: hidden;
        }
        #hd-cert-root .sig-box {
          margin-top: 8px; border: 1px dashed #94a3b8; border-radius: 10px;
          min-height: 110px; padding: 10px; background: #f8fafc;
          display: flex; align-items: center; justify-content: center;
        }
        #hd-cert-root .sig-box img { max-width: 100%; max-height: 140px; }
        #hd-cert-root .footer {
          margin-top: 22px; padding-top: 12px; border-top: 1px solid #e2e8f0;
          font-size: 11px; color: #64748b;
        }
        #hd-cert-root .muted { color: #94a3b8; font-size: 12px; }
      </style>

      <div class="brand">
        <div>
          <h1>My Wall — ${escapeHtml(title)}</h1>
          <p class="sub">עותק דיגיטלי של הצהרה חתומה · ${escapeHtml(templateNote || 'קיר הטיפוס')}</p>
        </div>
        <div class="badge">✓ נחתם</div>
      </div>

      <div class="grid">
        <div class="field"><div class="label">שם החותם / הורה</div><div class="value">${escapeHtml(parentName)}</div></div>
        <div class="field"><div class="label">ת.ז. חותם</div><div class="value">${escapeHtml(parentId)}</div></div>
        <div class="field"><div class="label">שם המתאמן/ת</div><div class="value">${escapeHtml(climberName)}</div></div>
        <div class="field"><div class="label">ת.ז. מתאמן/ת</div><div class="value">${escapeHtml(climberId)}</div></div>
        <div class="field"><div class="label">טלפון</div><div class="value">${escapeHtml(phone)}</div></div>
        <div class="field"><div class="label">תאריך לידה</div><div class="value">${escapeHtml(birthDate)}</div></div>
        <div class="field"><div class="label">תאריך חתימה</div><div class="value">${escapeHtml(date)}</div></div>
        <div class="field"><div class="label">אישור כתב ויתור</div><div class="value">${decl.waiverAccepted ? 'אושר' : '—'}</div></div>
      </div>

      <h2>שאלון רפואי</h2>
      ${answerRows(decl.answers || {}, questionLabels)}

      ${waiverText ? `<h2>כתב ויתור / הסרת אחריות</h2><div class="waiver">${escapeHtml(waiverText)}</div>` : ''}

      <h2>חתימה דיגיטלית</h2>
      <div class="sig-box">
        ${hasSig
          ? `<img src="${signature}" alt="חתימה" />`
          : '<div class="muted">לא נמצאה תמונת חתימה שמורה</div>'}
      </div>

      <div class="footer">
        מסמך זה הופק ממערכת My Wall CRM · מזהה הצהרה: ${escapeHtml(decl.id || '—')}
        ${decl.notes ? `<br/>הערות: ${escapeHtml(decl.notes)}` : ''}
      </div>
    </div>
  `;
}

/**
 * Build a PDF certificate for a signed health declaration.
 * @param {object} decl - health declaration record from the API
 * @returns {Promise<{ blob: Blob, fileName: string, pdf: import('jspdf').jsPDF }>}
 */
export async function buildHealthDeclarationPdf(decl) {
  if (!decl) throw new Error('אין הצהרה להורדה');

  const meta = await resolveWaiverAndQuestions(decl);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;z-index:-1;';
  host.innerHTML = buildCertificateHtml(decl, meta);
  document.body.appendChild(host);

  try {
    const root = host.querySelector('#hd-cert-root');
    const canvas = await html2canvas(root, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
    });

    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = 0;
    pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 5) {
      position -= pageHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    const climber = (decl.climberName || decl.studentName || 'declaration').replace(/[^\w\u0590-\u05ff-]+/g, '_');
    const date = decl.signedDate || decl.date || 'signed';
    const fileName = `health-declaration_${climber}_${date}.pdf`;
    const blob = pdf.output('blob');
    return { blob, fileName, pdf };
  } finally {
    document.body.removeChild(host);
  }
}

/**
 * Build and download a PDF certificate for a signed health declaration.
 * @param {object} decl - health declaration record from the API
 * @returns {Promise<void>}
 */
export async function downloadHealthDeclarationPdf(decl) {
  const { pdf, fileName } = await buildHealthDeclarationPdf(decl);
  pdf.save(fileName);
}

/** Convert a Blob to a base64 data-URL string. */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
