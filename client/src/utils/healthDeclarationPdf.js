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

/**
 * Signatures are drawn in white on the dark public form canvas.
 * For PDF (white paper) convert bright ink to dark so the signature is visible.
 */
function toPrintableSignature(dataUrl) {
  return new Promise((resolve) => {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
      resolve(dataUrl || '');
      return;
    }
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.width || 1;
        c.height = img.height || 1;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, c.width, c.height);
        const d = imageData.data;
        for (let i = 0; i < d.length; i += 4) {
          const a = d[i + 3];
          if (a < 8) continue;
          const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          // White / light ink → dark ink for print
          if (lum >= 140) {
            d[i] = 15;
            d[i + 1] = 23;
            d[i + 2] = 42;
            d[i + 3] = Math.max(a, 220);
          }
        }
        ctx.putImageData(imageData, 0, 0);
        resolve(c.toDataURL('image/png'));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
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
        <span class="mark">${yes ? '✓' : '—'}</span>
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

function buildCertificateHtml(decl, { waiverText, questionLabels, signatureSrc }) {
  const parentName = decl.parentName || decl.signedBy || '—';
  const climberName = decl.climberName || decl.studentName || '—';
  const phone = decl.phone || decl.emergencyPhone || '—';
  const date = decl.signedDate || decl.date || '—';
  const parentId = decl.parentIdNum || '—';
  const climberId = decl.climberIdNum || '—';
  const birthDate = decl.birthDate || '—';
  const signature = signatureSrc || decl.signature_url || decl.signature || '';
  const hasSig = typeof signature === 'string' && signature.startsWith('data:image');
  const title = decl.title || 'הצהרת בריאות + הסרת אחריות — אישור חתום';
  const templateNote = decl.templateSlug ? `תבנית: ${decl.templateSlug}` : '';

  return `
    <div id="hd-cert-root" dir="rtl" style="
      width: 794px; min-height: 900px; box-sizing: border-box;
      padding: 28px 36px; background: #fff; color: #111;
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
          display: flex; gap: 8px; align-items: flex-start; padding: 6px 8px;
          border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 4px; font-size: 11px;
        }
        #hd-cert-root .qa.yes { background: #f0fdf4; border-color: #bbf7d0; }
        #hd-cert-root .qa.no { background: #f8fafc; }
        #hd-cert-root .mark {
          font-weight: 800; min-width: 18px; color: #047857;
        }
        #hd-cert-root .qa.yes .mark { color: #047857; }
        #hd-cert-root .waiver {
          white-space: pre-wrap; font-size: 10px; line-height: 1.45; color: #334155;
          background: #fff7ed; border: 1px solid #fed7aa; border-radius: 10px; padding: 10px;
        }
        #hd-cert-root .sig-box {
          margin-top: 8px; border: 1px dashed #94a3b8; border-radius: 10px;
          min-height: 100px; padding: 8px; background: #ffffff;
          display: flex; align-items: center; justify-content: center;
          page-break-inside: avoid; break-inside: avoid;
        }
        #hd-cert-root .sig-box img {
          max-width: 100%; max-height: 120px; object-fit: contain;
          display: block;
        }
        #hd-cert-root .sig-section {
          page-break-inside: avoid; break-inside: avoid;
        }
        #hd-cert-root .footer {
          margin-top: 14px; padding-top: 10px; border-top: 1px solid #e2e8f0;
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

      <h2>הצהרת בריאות ובטיחות</h2>
      ${answerRows(decl.answers || {}, questionLabels)}

      ${waiverText ? `<h2>כתב ויתור / הסרת אחריות</h2><div class="waiver">${escapeHtml(waiverText)}</div>` : ''}

      <div class="sig-section">
        <h2>חתימה דיגיטלית</h2>
        <div class="sig-box">
          ${hasSig
            ? `<img src="${signature}" alt="חתימה" />`
            : '<div class="muted">לא נמצאה תמונת חתימה שמורה</div>'}
        </div>
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
  const rawSig = decl.signature_url || decl.signature || '';
  const signatureSrc = await toPrintableSignature(rawSig);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;z-index:-1;';
  host.innerHTML = buildCertificateHtml(decl, { ...meta, signatureSrc });
  document.body.appendChild(host);

  try {
    const root = host.querySelector('#hd-cert-root');
    const canvas = await html2canvas(root, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
    });

    // PNG avoids JPEG seam artifacts that look like a black bar through the signature
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    let imgWidth = pageWidth;
    let imgHeight = (canvas.height * imgWidth) / canvas.width;

    // Never slice through the signature — scale the whole certificate onto one page
    if (imgHeight > pageHeight) {
      const scale = pageHeight / imgHeight;
      imgWidth *= scale;
      imgHeight = pageHeight;
      const xOffset = (pageWidth - imgWidth) / 2;
      pdf.addImage(imgData, 'PNG', xOffset, 0, imgWidth, imgHeight);
    } else {
      pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
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
