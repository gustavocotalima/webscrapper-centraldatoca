import { VercelRequest, VercelResponse } from '@vercel/node';
import { processOneNewsItem, loadProcessedNews, saveProcessedNews } from '../src/index';

// This endpoint will process one news item at a time
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Authentication
  const secretKey = process.env.API_SECRET_KEY;
  const providedKey = req.query.key || req.headers['x-api-key'];
  
  if (secretKey && secretKey !== providedKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const url = req.query.url as string;
  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }
  
  try {
    const result = await processOneNewsItem(url);
    if (result) {
      res.status(200).json({ success: true, message: `Processed news item: ${url}` });
    } else {
      res.status(200).json({ success: false, message: `News item already processed or not found: ${url}` });
    }
  } catch (error) {
    console.error(`Error processing news item ${url}:`, error);
    res.status(500).json({ success: false, error: `Failed to process news item: ${url}` });
  }
}
