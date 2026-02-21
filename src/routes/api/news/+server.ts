import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import Parser from 'rss-parser';

const parser = new Parser();

export async function GET({ url }: RequestEvent) {
  try {
    const sourcesParam = url.searchParams.get('sources');
    const sources: string[] = sourcesParam
      ? JSON.parse(decodeURIComponent(sourcesParam))
      : ['https://feeds.bbci.co.uk/news/world/rss.xml', 'https://feeds.reuters.com/reuters/worldNews'];

    const results = await Promise.allSettled(sources.map(u => parser.parseURL(u)));
    const items: { title: string; link: string; source: string; pubDate: string; description: string }[] = [];

    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        const feed = result.value;
        const sourceName = feed.title?.replace(' - World', '').replace(' News', '').replace(' - Homepage', '') ?? sources[i];
        feed.items?.slice(0, 5).forEach(item => {
          if (item.title && item.link) {
            // Clean description: strip HTML tags, limit to 120 chars
            let desc = (item.contentSnippet || item.content || '').replace(/<[^>]*>/g, '').trim();
            if (desc.length > 120) desc = desc.slice(0, 117) + '…';
            items.push({ title: item.title, link: item.link, source: sourceName, pubDate: item.pubDate ?? '', description: desc });
          }
        });
      }
    });

    items.sort((a, b) => (b.pubDate ? new Date(b.pubDate).getTime() : 0) - (a.pubDate ? new Date(a.pubDate).getTime() : 0));
    return json({ items: items.slice(0, 20) });
  } catch {
    return json({ items: [] });
  }
}
