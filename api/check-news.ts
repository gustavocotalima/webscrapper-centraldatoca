import { VercelRequest, VercelResponse } from '@vercel/node';
import { main } from '../src/index';

// This endpoint will check for news when called
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Optional simple authentication using a secret key
  const secretKey = process.env.API_SECRET_KEY;
  const providedKey = req.query.key || req.headers['x-api-key'];
  
  if (secretKey && secretKey !== providedKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    await main();
    res.status(200).json({ success: true, message: 'Verificação de notícias concluída.' });
  } catch (error) {
    console.error('Error checking news:', error);
    res.status(500).json({ success: false, error: 'Falha ao verificar notícias.' });
  }
}
