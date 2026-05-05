const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxpmkzeyLvd4t2MtxEHDds1IOsbJ-F0yuKPR7aJ7OFPfLBAhXgF0Ryl8P1RFICH6-I7zw/exec';

export default async function handler(req, res) {
  // Add CORS headers for local development if needed
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    let url = SCRIPT_URL;
    
    // Forward query parameters for GET requests
    if (req.method === 'GET') {
      const queryString = new URLSearchParams(req.query).toString();
      url += `?${queryString}`;
    }

    const options = {
      method: req.method,
      redirect: 'follow'
    };

    if (req.method === 'POST') {
      options.body = JSON.stringify(req.body);
      options.headers = { 'Content-Type': 'application/json' };
    }

    const response = await fetch(url, options);
    const data = await response.json();

    res.status(200).json(data);
  } catch (error) {
    console.error('Proxy Error:', error);
    res.status(500).json({ error: 'Error comunicando con el servidor de Google' });
  }
}
