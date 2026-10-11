// AlphaFold DB access. File URLs come from the prediction API response,
// never hardcoded, so new model versions (v6, v7…) are picked up automatically.
(function (AFX) {
  const API = 'https://alphafold.ebi.ac.uk/api/prediction/';

  // UniProt accession format (https://www.uniprot.org/help/accession_numbers), optional isoform suffix.
  const ACCESSION = /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})(-\d+)?$/;

  class LoadError extends Error {
    constructor(title, detail) { super(title); this.title = title; this.detail = detail; }
  }
  AFX.LoadError = LoadError;

  AFX.normalizeId = function (raw) {
    // Accept "p69905", "AF-P69905-F1", or a pasted URL ending in the ID.
    const clean = s => s.replace(/^AF-/, '').replace(/-F\d+(-MODEL_V\d+)?(\.\w+)?$/, '');
    const parts = (raw || '').trim().toUpperCase().split(/[/?#=&]/).filter(Boolean).map(clean);
    return parts.reverse().find(p => ACCESSION.test(p)) || parts[0] || '';
  };

  AFX.isAccession = id => ACCESSION.test(id);

  async function getJSON(url, what) {
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      throw new LoadError(`Couldn't reach AlphaFold DB`, `Network error while fetching the ${what}. Check your connection and try again.`);
    }
    return res;
  }

  // Returns the metadata entry for the canonical sequence. The API also returns isoforms
  // (alternative versions of the protein, e.g. P38398-2), so match the accession exactly.
  AFX.fetchEntry = async function (id) {
    const res = await getJSON(API + encodeURIComponent(id), 'prediction metadata');
    if (res.status === 400) {
      throw new LoadError(`"${id}" isn't a valid UniProt accession`, 'UniProt IDs look like P69905 or Q8N726.');
    }
    if (res.status === 404) {
      throw new LoadError(`No AlphaFold prediction for ${id}`,
        'The ID may not exist, or the protein may be too long for AlphaFold DB (very large proteins like titin are not included).');
    }
    if (!res.ok) throw new LoadError('AlphaFold DB returned an error', `HTTP ${res.status} while fetching metadata.`);

    const entries = await res.json();
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new LoadError(`No AlphaFold prediction for ${id}`, 'AlphaFold DB has no models for this accession.');
    }
    return entries.find(e => e.uniprotAccession === id) || entries[0];
  };

  AFX.fetchStructure = async function (entry) {
    const url = entry.pdbUrl || entry.cifUrl;
    const format = entry.pdbUrl ? 'pdb' : 'cif';
    const res = await getJSON(url, 'structure file');
    if (!res.ok) throw new LoadError('Structure file unavailable', `HTTP ${res.status} for ${url}`);
    return { text: await res.text(), format };
  };

  // Returns { n, data: Float32Array(n*n) row-major, max }. Row = aligned residue, column = scored residue.
  AFX.fetchPAE = async function (entry) {
    if (!entry.paeDocUrl) throw new LoadError('No PAE available', 'This entry has no predicted aligned error file.');
    const res = await getJSON(entry.paeDocUrl, 'PAE matrix');
    if (!res.ok) throw new LoadError('PAE file unavailable', `HTTP ${res.status}`);
    let doc = await res.json();
    if (Array.isArray(doc)) doc = doc[0];

    let n, data;
    if (doc.predicted_aligned_error) {
      const m = doc.predicted_aligned_error;
      n = m.length;
      data = new Float32Array(n * n);
      for (let i = 0; i < n; i++) data.set(m[i], i * n);
    } else if (doc.distance) {
      // Legacy (pre-v3) flat format: residue1[], residue2[], distance[].
      n = Math.round(Math.sqrt(doc.distance.length));
      data = Float32Array.from(doc.distance);
    } else {
      throw new LoadError('Unrecognized PAE format', 'The PAE JSON did not contain a known matrix field.');
    }

    let max = doc.max_predicted_aligned_error;
    if (!max) { max = 0; for (const v of data) if (v > max) max = v; }
    return { n, data, max };
  };
})(window.AFX);
