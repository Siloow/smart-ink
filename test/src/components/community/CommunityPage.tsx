import { useEffect, useMemo, useState } from 'react';
import { DUMMY_COMMUNITY_POSTS, type CommunityPost, getAllCommunityTags } from './communityPosts';

type SortKey = 'newest' | 'mostLiked';

type PostStats = {
  liked: boolean;
  likes: number;
};

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '—';
  }
}

export default function CommunityPage() {
  const allTags = useMemo(() => getAllCommunityTags(DUMMY_COMMUNITY_POSTS), []);

  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState<string>('All');
  const [sortKey, setSortKey] = useState<SortKey>('newest');

  const [statsById, setStatsById] = useState<Record<string, PostStats>>(() => {
    const initial: Record<string, PostStats> = {};
    for (const p of DUMMY_COMMUNITY_POSTS) {
      initial[p.id] = { liked: false, likes: p.likes };
    }
    return initial;
  });

  const [activePostId, setActivePostId] = useState<string | null>(null);

  const activePost = useMemo(() => {
    if (!activePostId) return null;
    return DUMMY_COMMUNITY_POSTS.find((p) => p.id === activePostId) ?? null;
  }, [activePostId]);

  useEffect(() => {
    if (!activePostId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActivePostId(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activePostId]);

  const topArtist = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of DUMMY_COMMUNITY_POSTS) {
      counts.set(p.artistHandle, (counts.get(p.artistHandle) ?? 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!best) return null;
    const artistHandle = best[0];
    const count = best[1];
    return { artistHandle, count };
  }, []);

  const filteredPosts = useMemo(() => {
    const q = search.trim().toLowerCase();
    let posts: CommunityPost[] = DUMMY_COMMUNITY_POSTS;

    if (activeTag !== 'All') {
      posts = posts.filter((p) => p.tags.includes(activeTag));
    }

    if (q) {
      posts = posts.filter((p) => {
        const haystack = `${p.title} ${p.artistName} ${p.artistHandle} ${p.tags.join(' ')}`.toLowerCase();
        return haystack.includes(q);
      });
    }

    const postsWithLikes = posts.map((p) => ({ post: p, likes: statsById[p.id]?.likes ?? p.likes }));

    postsWithLikes.sort((a, b) => {
      if (sortKey === 'mostLiked') return b.likes - a.likes;
      // newest
      return new Date(b.post.createdAt).getTime() - new Date(a.post.createdAt).getTime();
    });

    return postsWithLikes.map((x) => x.post);
  }, [activeTag, search, sortKey, statsById]);

  const featuredCount = 3;
  const featured = filteredPosts.slice(0, featuredCount);
  const rest = filteredPosts.slice(featuredCount);

  const toggleLike = (postId: string) => {
    setStatsById((prev) => {
      const cur = prev[postId] ?? { liked: false, likes: 0 };
      const nextLiked = !cur.liked;
      return {
        ...prev,
        [postId]: { liked: nextLiked, likes: Math.max(0, cur.likes + (nextLiked ? 1 : -1)) },
      };
    });
  };

  return (
    <div className="community-page">
      <div className="community-header">
        <div>
          <h2 className="community-title">Community</h2>
          <p className="community-subtitle">Artist-made tattoo renders. Explore, like, and preview ideas.</p>
        </div>

        <div className="community-header-stats" aria-label="Community stats">
          <div className="community-stat">
            <div className="community-stat-value">{DUMMY_COMMUNITY_POSTS.length}</div>
            <div className="community-stat-label">Posts</div>
          </div>
          <div className="community-stat">
            <div className="community-stat-value">{allTags.length}</div>
            <div className="community-stat-label">Tags</div>
          </div>
          {topArtist && (
            <div className="community-stat">
              <div className="community-stat-value">{topArtist.count}</div>
              <div className="community-stat-label">Top artist</div>
            </div>
          )}
        </div>
      </div>

      <div className="community-filters" role="region" aria-label="Post filters">
        <div className="community-search">
          <span className="community-search-icon" aria-hidden>
            🔎
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search posts, artists, or tags"
            aria-label="Search community posts"
          />
        </div>

        <div className="community-tags" aria-label="Tag filters">
          <button
            type="button"
            className={`community-tag-pill${activeTag === 'All' ? ' community-tag-pill--active' : ''}`}
            onClick={() => setActiveTag('All')}
          >
            All
          </button>
          {allTags.slice(0, 10).map((t) => (
            <button
              key={t}
              type="button"
              className={`community-tag-pill${activeTag === t ? ' community-tag-pill--active' : ''}`}
              onClick={() => setActiveTag(t)}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="community-sort">
          <label className="community-sort-label" htmlFor="community-sort">
            Sort
          </label>
          <select
            id="community-sort"
            className="community-sort-select"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
          >
            <option value="newest">Newest</option>
            <option value="mostLiked">Most liked</option>
          </select>
        </div>
      </div>

      {filteredPosts.length === 0 ? (
        <div className="community-empty">No posts match your filters.</div>
      ) : (
        <>
          {featured.length > 0 && (
            <div className="community-featured-grid" aria-label="Featured posts">
              {featured.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="community-post-card community-post-card--featured"
                  onClick={() => setActivePostId(p.id)}
                >
                  <div className="community-post-thumb">
                    <img src={p.renderSrc} alt={p.renderAlt} />
                  </div>
                  <div className="community-post-body">
                    <div className="community-post-title">{p.title}</div>
                    <div className="community-post-artist">
                      {p.artistName} <span className="community-post-handle">{p.artistHandle}</span>
                    </div>
                    <div className="community-post-tags">
                      {p.tags.slice(0, 3).map((t) => (
                        <span key={t} className="community-post-tag">
                          {t}
                        </span>
                      ))}
                    </div>
                    <div className="community-post-footer">
                      <span className="community-post-likes">❤ {statsById[p.id]?.likes ?? p.likes}</span>
                      <span className="community-post-date">{formatDate(p.createdAt)}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {rest.length > 0 && (
            <div className="community-post-grid" aria-label="All posts">
              {rest.map((p) => (
                <div key={p.id} className="community-post-card" role="group" aria-label={p.title}>
                  <button
                    type="button"
                    className="community-post-clickarea"
                    onClick={() => setActivePostId(p.id)}
                    aria-label={`Open post: ${p.title}`}
                  >
                    <div className="community-post-thumb">
                      <img src={p.renderSrc} alt={p.renderAlt} />
                    </div>
                    <div className="community-post-body">
                      <div className="community-post-title">{p.title}</div>
                      <div className="community-post-artist">
                        {p.artistName} <span className="community-post-handle">{p.artistHandle}</span>
                      </div>
                      <div className="community-post-tags">
                        {p.tags.slice(0, 3).map((t) => (
                          <span key={t} className="community-post-tag">
                            {t}
                          </span>
                        ))}
                      </div>
                      <div className="community-post-footer">
                        <span className="community-post-likes">❤ {statsById[p.id]?.likes ?? p.likes}</span>
                        <span className="community-post-date">{formatDate(p.createdAt)}</span>
                      </div>
                    </div>
                  </button>

                  <div className="community-post-actions" aria-label="Post actions">
                    <button
                      type="button"
                      className={`community-like-btn${statsById[p.id]?.liked ? ' community-like-btn--active' : ''}`}
                      onClick={() => toggleLike(p.id)}
                    >
                      {statsById[p.id]?.liked ? 'Liked' : 'Like'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {activePost && (
        <div
          className="modal-overlay community-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`Post: ${activePost.title}`}
          onMouseDown={(e) => {
            // Close when clicking the backdrop only.
            if (e.target === e.currentTarget) setActivePostId(null);
          }}
        >
          <div className="modal-card community-modal-card">
            <h2>{activePost.title}</h2>

            <div className="community-modal-image">
              <img src={activePost.renderSrc} alt={activePost.renderAlt} />
            </div>

            <div className="community-modal-meta">
              <div className="community-modal-artist">
                {activePost.artistName} <span className="community-post-handle">{activePost.artistHandle}</span>
              </div>
              <div className="community-modal-date">{formatDate(activePost.createdAt)}</div>
            </div>

            <div className="community-modal-tags">
              {activePost.tags.map((t) => (
                <span key={t} className="community-post-tag community-post-tag--modal">
                  {t}
                </span>
              ))}
            </div>

            <p className="community-modal-desc">{activePost.description}</p>

            <div className="community-modal-actions">
              <button
                type="button"
                className={`community-like-btn community-like-btn--big${
                  statsById[activePost.id]?.liked ? ' community-like-btn--active' : ''
                }`}
                onClick={() => toggleLike(activePost.id)}
              >
                ❤ {statsById[activePost.id]?.likes ?? activePost.likes}
              </button>
              <button type="button" className="btn-modal-cancel" onClick={() => setActivePostId(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

