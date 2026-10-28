import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseDate} from '../scripts/chain/evidence.mjs';
test('publication metadata outranks historical dates in article prose',()=>assert.equal(releaseDate('<meta property="article:published_time" content="2026-10-01T09:00:00Z"><article>Agreement signed January 2, 2025.</article>','Agreement signed January 2, 2025.'),'2026-10-01'));
test('conflicting publication metadata fails closed',()=>assert.equal(releaseDate('<meta name="datePublished" content="2026-10-01"><script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-10-02"}</script>',''),null));
test('matching JSON-LD and metadata are accepted',()=>assert.equal(releaseDate('<meta name="date" content="2026-10-01"><script type="application/ld+json">{"@graph":[{"@type":"WebSite"},{"@type":"NewsArticle","datePublished":"2026-10-01T12:00:00Z"}]}</script>',''),'2026-10-01'));
test('a related article date never overrides the primary JSON-LD article',()=>assert.equal(releaseDate('<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-10-01","citation":{"@type":"NewsArticle","datePublished":"2020-01-01"}}</script>',''),'2026-10-01'));
test('invalid calendar dates are rejected instead of normalized',()=>{for(const date of ['2026-02-30','2025-02-29','2026-13-01'])assert.equal(releaseDate(`<meta name="date" content="${date}">`,''),null);assert.equal(releaseDate('<meta name="date" content="2024-02-29">',''),'2024-02-29');});
test('explicit publication time or date element is accepted without metadata',()=>{assert.equal(releaseDate('<article><time datetime="2026-10-01">October 1, 2026</time></article>',''),'2026-10-01');assert.equal(releaseDate('<article><span class="release-date">October 1, 2026</span></article>',''),'2026-10-01');});
test('historical body prose and related cards do not supply publication dates',()=>{assert.equal(releaseDate('<article><p>The agreement signed January 2, 2025 expanded today.</p></article>','The agreement signed January 2, 2025 expanded today.'),null);assert.equal(releaseDate('<article><aside><time datetime="2025-01-02"></time></aside></article>',''),null);});
test('wire-style dateline supplies publication date',()=>assert.equal(releaseDate('<article><p>SANTA CLARA, Calif., October 1, 2026 — The companies announced a partnership.</p></article>',''),'2026-10-01'));
test('historical prose followed by a dash is not a wire dateline',()=>assert.equal(releaseDate('<article><p>Our agreement dated October 1, 2025 — now expanded with further products.</p></article>',''),null));
test('title-case and mixed-case publisher datelines have publication dates',()=>{
 assert.equal(releaseDate('<article><p>San Jose, Calif.—April 13, 2026— Bloom Energy announced an agreement.</p></article>'),'2026-04-13');
 assert.equal(releaseDate('<article><p><strong>SAN JOSE, Calif. – October 13, 2025</strong> – Bloom Energy announced an agreement.</p></article>'),'2025-10-13');
 assert.equal(releaseDate('<main><div>Press Release</div><p>Austin, Texas&mdash;August 13, 2026</p><p>Oracle announced an agreement.</p></main>'),'2026-08-13');
});
test('later historical dateline is excluded from publication detection',()=>{
 const earlier=Array.from({length:8},()=>'<p>This release discusses recent developments.</p>').join('');
 assert.equal(releaseDate(`<article>${earlier}<p>SAN JOSE, Calif. – October 13, 2025 – Historical announcement quoted below.</p></article>`),null);
});
