import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import Parser from 'rss-parser';

const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: false }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: false }],
      ['enclosure', 'enclosure', { keepArray: false }],
    ],
  },
});

function extractImageUrl(item: any): string {
  // Try media:content
  if (item.mediaContent?.['$']?.url) return item.mediaContent['$'].url;
  if (item.mediaContent?.url) return item.mediaContent.url;
  // Try media:thumbnail
  if (item.mediaThumbnail?.['$']?.url) return item.mediaThumbnail['$'].url;
  if (item.mediaThumbnail?.url) return item.mediaThumbnail.url;
  // Try enclosure (standard RSS images)
  if (item.enclosure?.url && item.enclosure?.type?.startsWith('image')) return item.enclosure.url;
  // Try scraping first <img> from content
  const html = item.content || item['content:encoded'] || '';
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (match?.[1]) return match[1];
  return '';
}

export async function GET({ url }: RequestEvent) {
  try {
    const sourcesParam = url.searchParams.get('sources');
    const sources: string[] = sourcesParam
      ? JSON.parse(decodeURIComponent(sourcesParam))
      : ['https://feeds.bbci.co.uk/news/world/rss.xml', 'https://feeds.reuters.com/reuters/worldNews'];

    const results = await Promise.allSettled(sources.map(u => parser.parseURL(u)));
    const items: { title: string; link: string; source: string; pubDate: string; description: string; image: string }[] = [];

    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        const feed = result.value;
        const sourceName = feed.title?.replace(' - World', '').replace(' News', '').replace(' - Homepage', '') ?? sources[i];
        feed.items?.slice(0, 5).forEach((item: any) => {
          if (item.title && item.link) {
            // Clean description: strip HTML tags, limit to 120 chars
            let desc = (item.contentSnippet || item.content || '').replace(/<[^>]*>/g, '').trim();
            if (desc.length > 120) desc = desc.slice(0, 117) + '…';
            const image = extractImageUrl(item);
            items.push({ title: item.title, link: item.link, source: sourceName, pubDate: item.pubDate ?? '', description: desc, image });
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
