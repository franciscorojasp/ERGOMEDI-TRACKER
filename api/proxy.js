const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxpmkzeyLvd4t2MtxEHDds1IOsbJ-F0yuKPR7aJ7OFPfLBAhXgF0Ryl8P1RFICH6-I7zw/exec';

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    let url = SCRIPT_URL;
    
    const params = new URLSearchParams();
    if (req.method === 'GET') {
      for (const key in req.query) {
        params.append(key, req.query[key]);
      }
      url += (url.includes('?') ? '&' : '?') + params.toString();
    }

    const fetchOptions = {
      method: req.method,
      redirect: 'follow',
    };

    if (req.method === 'POST') {
      fetchOptions.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      fetchOptions.headers = { 'Content-Type': 'application/json' };
    }

    const response = await fetch(url, fetchOptions);
    
    // Google Apps Script always returns a redirect (302) or a 200 with the content
    // Node-fetch handles redirects automatically with redirect: 'follow'
    
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      // If it's not JSON, it might be an error page from Google
      return res.status(502).json({ error: 'Google returned non-JSON response', detail: text.substring(0, 200) });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('Proxy Error:', error);
    return res.status(500).json({ error: 'Server error in Proxy', message: error.message });
  }
}
