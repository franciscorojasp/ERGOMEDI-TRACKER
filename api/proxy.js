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
    const url = SCRIPT_URL;
    const method = req.method;
    
    let fetchOptions = {
      method: method,
      redirect: 'follow',
    };

    if (method === 'POST') {
      // Send as plain text/JSON string to be ultra-compatible with GAS
      fetchOptions.body = JSON.stringify(req.body);
      // We don't send content-type to avoid preflight issues in some environments, 
      // GAS will read the raw body anyway.
    } else {
      // Forward query params for GET
      const targetUrl = new URL(url);
      Object.keys(req.query).forEach(key => targetUrl.searchParams.append(key, req.query[key]));
      return res.redirect(targetUrl.toString()); // Direct redirect for GETs is also valid for Proxy
    }

    const response = await fetch(url, fetchOptions);
    const text = await response.text();
    
    try {
      const data = JSON.parse(text);
      return res.status(200).json(data);
    } catch (e) {
      return res.status(200).send(text);
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
