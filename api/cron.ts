import { VercelRequest, VercelResponse } from '@vercel/node';
import { main } from '../src/index';

// This function will be triggered by Vercel's cron job every 5 minutes
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    await main();
    res.status(200).json({ success: true, message: 'Verificação de notícias concluída.' });
  } catch (error) {
    console.error('Error in cron job:', error);
    res.status(500).json({ success: false, error: 'Falha ao verificar notícias.' });
  }
}
