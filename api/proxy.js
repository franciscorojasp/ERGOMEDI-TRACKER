const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxpmkzeyLvd4t2MtxEHDds1IOsbJ-F0yuKPR7aJ7OFPfLBAhXgF0Ryl8P1RFICH6-I7zw/exec';

export default async function handler(req, res) {
  // Ultra-simple Proxy
  try {
    const { method, query, body } = req;
    
    // Construct target URL
    const targetUrl = new URL(SCRIPT_URL);
    Object.keys(query).forEach(key => targetUrl.searchParams.append(key, query[key]));

    const response = await fetch(targetUrl.toString(), {
      method,
      redirect: 'follow',
      body: method === 'POST' ? JSON.stringify(body) : undefined,
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined
    });

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ 
      error: 'Communication Error', 
      details: error.message 
    });
  }
}
