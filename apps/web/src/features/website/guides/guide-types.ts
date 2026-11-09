// Mirrors the public guides contract (GUIDES-CONTRACT.md). Shapes only; the server does the sanitizing.
export type Inline = { text: string; bold?: boolean; italic?: boolean; href?: string };

export type Block =
  | { type: 'heading'; level: 2 | 3; text: string; id?: string }
  | { type: 'paragraph'; content: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'quote'; content: Inline[]; cite?: string }
  | { type: 'image'; url: string; alt: string; caption?: string }
  | { type: 'callout'; tone: 'tip' | 'note'; content: Inline[] }
  | { type: 'divider' };

export type PostSummary = {
  slug: string;
  title: string;
  summary: string;
  category: string | null;
  tags: string[];
  cover: { url: string; alt: string } | null;
  published_at: string;
  reading_minutes: number;
  author_name: string;
};

export type Seo = {
  meta_title: string;
  meta_description: string;
  canonical_url: string | null;
  og_title: string | null;
  og_description: string | null;
  og_image_url: string | null;
  noindex: boolean;
};

export type PostFull = PostSummary & { body: Block[]; updated_at: string; seo: Seo };

export type GuidesListResult = { posts: PostSummary[]; categories: string[]; next_cursor: string | null };
export type GuideResult = { post: PostFull; related: PostSummary[] };
