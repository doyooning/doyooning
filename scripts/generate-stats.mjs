import { mkdir, writeFile } from 'node:fs/promises';

const user = process.env.PROFILE_USER || 'doyooning';
if (!/^[a-z\d-]+$/i.test(user)) throw new Error('Invalid GitHub username');
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'profile-stats-generator', 'X-GitHub-Api-Version': '2022-11-28' };
if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
async function api(path) {
  const response = await fetch(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${path}`);
  const data = await response.json();
  if (data.incomplete_results) throw new Error(`Incomplete search results: ${path}`);
  return data;
}
const now = new Date();
const from = new Date(now); from.setUTCFullYear(from.getUTCFullYear() - 1);
const date = d => d.toISOString().slice(0, 10);
const range = `${date(from)}..${date(now)}`;
const count = async (endpoint, query) => (await api(`/search/${endpoint}?q=${encodeURIComponent(query)}&per_page=1`)).total_count;
const commits = await count('commits', `author:${user} committer-date:${range}`);
const prs = await count('issues', `author:${user} type:pr is:public created:${range}`);
const issues = await count('issues', `author:${user} type:issue is:public created:${range}`);
const publicRepos = [];
for (let page = 1; ; page++) {
  const batch = await api(`/users/${user}/repos?type=owner&per_page=100&page=${page}`);
  publicRepos.push(...batch.filter(r => !r.private));
  if (batch.length < 100) break;
}
const repos = publicRepos;
const languageRepos = publicRepos;
const languages = {};
for (const repo of languageRepos) {
  const data = await api(`/repos/${user}/${repo.name}/languages`);
  for (const [language, bytes] of Object.entries(data)) languages[language] = (languages[language] || 0) + bytes;
}
const total = Object.values(languages).reduce((a, b) => a + b, 0);
const sorted = Object.entries(languages).sort((a, b) => b[1] - a[1]);
const rows = sorted.slice(0, 6);
if (sorted.length > 6) rows.push(['Others', sorted.slice(6).reduce((sum, [, n]) => sum + n, 0)]);
const stats = { user, updatedAt: now.toISOString(), activityPeriod: { from: date(from), to: date(now) }, scope: 'Public GitHub indexed activity and language bytes from owned public repositories including forks', commits, pullRequests: prs, issues, repositories: repos.length, stars: repos.reduce((sum, r) => sum + r.stargazers_count, 0), languageBytes: languages, repositoriesIncluded: repos.map(r => r.full_name), languageRepositoriesIncluded: languageRepos.map(r => r.full_name) };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const colors = ['#60a5fa', '#4ade80', '#fbbf24', '#c084fc', '#fb7185', '#2dd4bf', '#94a3b8'];
function card(title, body, footer) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="270" viewBox="0 0 440 270" role="img"><title>${esc(title)}</title><desc>${esc(footer)}</desc><rect x="1" y="1" width="438" height="268" rx="14" fill="#0d1117" stroke="#30363d"/><g font-family="Arial, sans-serif"><text x="24" y="37" font-size="19" font-weight="700" fill="#f0f6fc">${esc(title)}</text>${body}<text x="24" y="238" font-size="10" fill="#9da7b3">${esc(footer)}</text><text x="24" y="255" font-size="10" fill="#9da7b3">Updated ${date(now)} UTC</text></g></svg>\n`;
}
const metrics = [['Commits (indexed)', commits], ['Pull requests', prs], ['Issues opened', issues], ['Public repos (incl. forks)', repos.length], ['Stars received', stats.stars]];
let activity = `<text x="24" y="59" font-size="11" fill="#9da7b3">Public activity · ${date(from)} to ${date(now)}</text>`;
metrics.forEach(([label, value], i) => { const y = 89 + i * 27; activity += `<text x="24" y="${y}" font-size="13" fill="#c9d1d9">${esc(label)}</text><text x="413" y="${y}" text-anchor="end" font-size="17" font-weight="700" fill="#60a5fa">${value.toLocaleString('en-US')}</text>`; });
let lang = '<text x="24" y="59" font-size="11" fill="#9da7b3">Owned public repositories · forks included</text>';
if (total) {
  let x = 24;
  rows.forEach(([name, bytes], i) => {
    const width = bytes / total * 392;
    lang += `<rect x="${x.toFixed(3)}" y="74" width="${width.toFixed(3)}" height="10" fill="${colors[i]}"/>`;
    x += width;
    const y = 105 + i * 17;
    lang += `<circle cx="29" cy="${y - 4}" r="4" fill="${colors[i]}"/><text x="40" y="${y}" font-size="12" fill="#c9d1d9">${esc(name)}</text><text x="415" y="${y}" text-anchor="end" font-size="12" fill="#c9d1d9">${(bytes / total * 100).toFixed(1)}%</text>`;
  });
} else lang += '<text x="24" y="110" fill="#c9d1d9" font-size="13">No language data available</text>';
await mkdir('assets/stats', { recursive: true });
await writeFile('assets/stats/activity.svg', card('Activity Overview', activity, 'Commits / PRs / issues: past 12 months · repos / stars: current, forks included'));
await writeFile('assets/stats/languages.svg', card('Languages', lang, 'Share of code bytes · not a measure of proficiency'));
await writeFile('assets/stats/data.json', JSON.stringify(stats, null, 2) + '\n');
console.log(`Generated cards: ${repos.length} public repositories including forks, ${languageRepos.length} language repositories, ${sorted.length} languages; ${commits} commits, ${prs} PRs, ${issues} issues`);
