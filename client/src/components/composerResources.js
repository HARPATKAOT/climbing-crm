/**
 * The two lists every conversation composer needs — approved templates and
 * saved replies. Kept at module scope so moving between customers does not
 * repeat the same two API round trips.
 *
 * It lives in its own file so the templates management screen can drop the
 * cache after a change without pulling the whole conversation panel with it.
 */
let approvedTemplatesCache = null;
let savedRepliesCache = null;
let composerResourcesPromise = null;

export function cachedComposerTemplates() {
  return approvedTemplatesCache;
}

export function cachedSavedReplies() {
  return savedRepliesCache;
}

/**
 * The cache lives as long as the tab does, so a template switched on for manual
 * sending would not reach a composer opened later in the same session.
 */
export function invalidateComposerResources() {
  approvedTemplatesCache = null;
  savedRepliesCache = null;
}

export async function loadComposerResources() {
  if (Array.isArray(approvedTemplatesCache) && Array.isArray(savedRepliesCache)) {
    return { templates: approvedTemplatesCache, savedReplies: savedRepliesCache };
  }
  if (!composerResourcesPromise) {
    composerResourcesPromise = Promise.all([
      fetch('/api/message-templates?approved=1&archived=1')
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null),
      fetch('/api/saved-replies')
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null),
    ]).then(([templates, savedReplies]) => {
      if (Array.isArray(templates)) approvedTemplatesCache = templates;
      if (Array.isArray(savedReplies)) savedRepliesCache = savedReplies;
      return { templates, savedReplies };
    }).finally(() => {
      composerResourcesPromise = null;
    });
  }
  return composerResourcesPromise;
}
