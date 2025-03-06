import { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchNewsUrls, loadProcessedNews, saveProcessedNews } from '../src/index';

// Storage for pending items (will be lost on function restart but only used briefly)
let pendingItems: Array<{ title: string; url: string }> = [];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Authentication
  const secretKey = process.env.API_SECRET_KEY;
  const providedKey = req.query.key || req.headers['x-api-key'];
  
  if (secretKey && secretKey !== providedKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  // Check if we're requesting the list of pending items
  const action = req.query.action as string;
  if (action === 'list_pending') {
    return res.status(200).json({ 
      success: true, 
      items: pendingItems 
    });
  }
  
  try {
    // Only fetch news URLs in this function - faster operation
    console.log('Fetching news URLs...');
    const newsItems = await fetchNewsUrls();
    console.log(`Found ${newsItems.length} news items`);
    
    // Load already processed URLs
    const processedNews = await loadProcessedNews();
    
    // Filter for new items
    const newItems = newsItems.filter(item => !processedNews.has(item.url));
    console.log(`${newItems.length} new items to process`);
    
    if (newItems.length > 0) {
      // Store the new items temporarily for the next GitHub Action step to retrieve
      pendingItems = newItems;
      
      // Return the number of items to process
      res.status(200).json({ 
        success: true, 
        message: `Found ${newItems.length} new items to process.`,
        items: newItems.map(item => ({ title: item.title, url: item.url }))
      });
      
      // Mark each URL as "pending" in the persistent storage
      for (const item of newItems) {
        processedNews.add(item.url);
      }
      await saveProcessedNews(processedNews);
    } else {
      pendingItems = [];
      res.status(200).json({ 
        success: true, 
        message: 'No new news items found.',
        items: []
      });
    }
  } catch (error) {
    console.error('Error checking news:', error);
    res.status(500).json({ success: false, error: 'Failed to check news.' });
  }
}
