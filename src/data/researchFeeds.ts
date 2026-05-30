/**
 * Research feed catalog — 500+ feed definitions for the network research phase.
 * These are created as shadow tracks (not published) to measure post volume.
 *
 * Uses the same SystemFeedDef type as systemFeeds.ts.
 */

import type { SystemFeedDef } from './systemFeeds.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function geo(city: string, region?: string, extraKeywords: string[] = []): SystemFeedDef {
  const location = region ? `${city}, ${region}` : city;
  return {
    name: `${city} News`,
    query: `local news, events, politics, and community developments in ${location}`,
    keywords: [city.toLowerCase(), ...(region ? [region.toLowerCase()] : []), ...extraKeywords],
    threshold: 0.65,
    description: `News and discussions about ${location}.`,
    category: 'geographic',
  };
}

function topic(name: string, query: string, keywords: string[], threshold = 0.68): SystemFeedDef {
  return {
    name,
    query,
    keywords,
    threshold,
    description: query,
    category: 'niche',
  };
}

function broad(name: string, query: string, keywords: string[], threshold = 0.62): SystemFeedDef {
  return {
    name,
    query,
    keywords,
    threshold,
    description: query,
    category: 'broad',
  };
}

// ─── US Cities: Tier 1 (Top 50 metros) ─────────────────────────────────────

const usTier1: SystemFeedDef[] = [
  geo('Houston', 'TX'),
  geo('Phoenix', 'AZ'),
  geo('San Antonio', 'TX'),
  geo('San Diego', 'CA'),
  geo('Dallas', 'TX'),
  geo('San Jose', 'CA'),
  geo('Jacksonville', 'FL'),
  geo('Fort Worth', 'TX'),
  geo('Columbus', 'OH'),
  geo('Charlotte', 'NC'),
  geo('Indianapolis', 'IN'),
  geo('Memphis', 'TN'),
  geo('Baltimore', 'MD'),
  geo('Milwaukee', 'WI'),
  geo('Albuquerque', 'NM'),
  geo('Tucson', 'AZ'),
  geo('Sacramento', 'CA'),
  geo('Kansas City', 'MO'),
  geo('Las Vegas', 'NV'),
  geo('Oklahoma City', 'OK'),
  geo('Louisville', 'KY'),
  geo('Richmond', 'VA'),
  geo('Hartford', 'CT'),
  geo('Buffalo', 'NY'),
  geo('Cincinnati', 'OH'),
  geo('Cleveland', 'OH'),
  geo('Orlando', 'FL'),
  geo('Tampa', 'FL'),
  geo('St. Louis', 'MO'),
  geo('Honolulu', 'HI'),
];

// ─── US Cities: Tier 2 (Mid-size, tech/culture hubs) ────────────────────────

const usTier2: SystemFeedDef[] = [
  geo('Boise', 'ID'),
  geo('Savannah', 'GA'),
  geo('Asheville', 'NC'),
  geo('Charleston', 'SC'),
  geo('Madison', 'WI'),
  geo('Ann Arbor', 'MI'),
  geo('Boulder', 'CO'),
  geo('Santa Fe', 'NM'),
  geo('Chattanooga', 'TN'),
  geo('Greenville', 'SC'),
  geo('Bend', 'OR'),
  geo('Durham', 'NC'),
  geo('Lexington', 'KY'),
  geo('Knoxville', 'TN'),
  geo('Spokane', 'WA'),
  geo('Tulsa', 'OK'),
  geo('Des Moines', 'IA'),
  geo('Providence', 'RI'),
  geo('Omaha', 'NE'),
  geo('Provo', 'UT'),
  geo('Tacoma', 'WA'),
  geo('Reno', 'NV'),
  geo('Dayton', 'OH'),
  geo('Birmingham', 'AL'),
  geo('Little Rock', 'AR'),
  geo('Anchorage', 'AK'),
  geo('Sioux Falls', 'SD'),
  geo('Fargo', 'ND'),
  geo('Burlington', 'VT'),
  geo('Portland', 'ME'),
];

// ─── US Regions ─────────────────────────────────────────────────────────────

const usRegions: SystemFeedDef[] = [
  topic('Research Triangle', 'news from the Research Triangle in North Carolina including Raleigh Durham Chapel Hill', ['research triangle', 'raleigh', 'durham', 'chapel hill', 'RTP'], 0.65),
  topic('Silicon Valley', 'news from Silicon Valley and the San Francisco Bay Area tech scene', ['silicon valley', 'bay area', 'palo alto', 'mountain view', 'menlo park', 'cupertino'], 0.65),
  topic('Silicon Slopes', 'news from the Silicon Slopes tech hub in Utah', ['silicon slopes', 'lehi', 'provo', 'utah tech'], 0.65),
  topic('Pacific Northwest', 'news from the Pacific Northwest including Washington Oregon', ['pacific northwest', 'PNW', 'cascadia'], 0.62),
  topic('New England', 'news from New England states', ['new england', 'maine', 'vermont', 'connecticut', 'massachusetts', 'new hampshire', 'rhode island'], 0.62),
  topic('Texas Triangle', 'news from the major Texas metro areas', ['texas', 'DFW', 'houston metro', 'san antonio metro', 'austin metro'], 0.62),
];

// ─── International Cities ───────────────────────────────────────────────────

const international: SystemFeedDef[] = [
  geo('Paris', 'France'),
  geo('Tokyo', 'Japan'),
  geo('Sydney', 'Australia'),
  geo('Melbourne', 'Australia'),
  geo('São Paulo', 'Brazil'),
  geo('Mexico City', 'Mexico'),
  geo('Dublin', 'Ireland'),
  geo('Edinburgh', 'Scotland'),
  geo('Manchester', 'UK'),
  geo('Barcelona', 'Spain'),
  geo('Madrid', 'Spain'),
  geo('Munich', 'Germany'),
  geo('Lisbon', 'Portugal'),
  geo('Copenhagen', 'Denmark'),
  geo('Stockholm', 'Sweden'),
  geo('Oslo', 'Norway'),
  geo('Helsinki', 'Finland'),
  geo('Vienna', 'Austria'),
  geo('Zurich', 'Switzerland'),
  geo('Brussels', 'Belgium'),
  geo('Auckland', 'New Zealand'),
  geo('Montreal', 'Canada'),
  geo('Calgary', 'Canada'),
  geo('Seoul', 'South Korea'),
  geo('Singapore'),
  geo('Tel Aviv', 'Israel'),
  geo('Cape Town', 'South Africa'),
  geo('Bangalore', 'India'),
  geo('Nairobi', 'Kenya'),
  geo('Buenos Aires', 'Argentina'),
];

// ─── Technology ─────────────────────────────────────────────────────────────

const technology: SystemFeedDef[] = [
  topic('AI Research', 'artificial intelligence breakthroughs, machine learning papers, LLM developments', ['AI', 'artificial intelligence', 'machine learning', 'deep learning', 'LLM', 'GPT', 'transformer', 'neural network']),
  topic('AI Ethics', 'AI safety, alignment, responsible AI development, AI regulation and governance', ['AI safety', 'AI ethics', 'alignment', 'responsible AI', 'AI regulation', 'AI bias']),
  topic('Web Development', 'frontend and backend web development, frameworks, JavaScript ecosystem', ['web dev', 'javascript', 'typescript', 'react', 'vue', 'svelte', 'nextjs', 'CSS', 'HTML', 'frontend', 'backend']),
  topic('Cybersecurity', 'cybersecurity news, vulnerabilities, data breaches, infosec community', ['cybersecurity', 'infosec', 'vulnerability', 'CVE', 'data breach', 'ransomware', 'zero-day', 'pentest']),
  topic('Cloud & DevOps', 'cloud computing, Kubernetes, Docker, infrastructure as code, CI/CD', ['cloud', 'kubernetes', 'docker', 'terraform', 'AWS', 'GCP', 'Azure', 'devops', 'CI/CD', 'infrastructure']),
  topic('Rust Programming', 'Rust programming language news, crates, and community', ['rust', 'rustlang', 'cargo', 'crate', 'rust programming']),
  topic('Python', 'Python programming language, packages, data science with Python', ['python', 'pip', 'django', 'flask', 'fastapi', 'pandas', 'numpy']),
  topic('Apple & iOS', 'Apple news, iOS development, macOS, Swift, WWDC', ['apple', 'iOS', 'macOS', 'swift', 'WWDC', 'iPhone', 'iPad', 'Mac']),
  topic('Android', 'Android development, Google mobile, Kotlin, Material Design', ['android', 'kotlin', 'google play', 'material design', 'pixel']),
  topic('Linux & Sysadmin', 'Linux distributions, system administration, server management', ['linux', 'sysadmin', 'ubuntu', 'fedora', 'arch linux', 'NixOS', 'systemd', 'bash']),
  topic('Databases', 'database technology, PostgreSQL, MySQL, Redis, database design', ['postgresql', 'postgres', 'mysql', 'redis', 'mongodb', 'sqlite', 'database', 'SQL']),
  topic('Game Development', 'game development, game engines, indie game dev, Unity, Unreal, Godot', ['gamedev', 'game development', 'unity', 'unreal engine', 'godot', 'indie game', 'game design']),
  topic('Robotics', 'robotics engineering, autonomous systems, drones, industrial automation', ['robotics', 'robot', 'drone', 'autonomous', 'ROS', 'automation']),
  topic('VR & AR', 'virtual reality, augmented reality, spatial computing, mixed reality', ['VR', 'AR', 'virtual reality', 'augmented reality', 'spatial computing', 'Quest', 'Vision Pro']),
  topic('3D Printing', '3D printing, additive manufacturing, maker community', ['3d printing', '3d printer', 'additive manufacturing', 'FDM', 'resin printing', 'maker']),
  topic('Home Automation', 'smart home, home automation, IoT devices, Home Assistant', ['smart home', 'home automation', 'home assistant', 'IoT', 'zigbee', 'matter protocol']),
  topic('Networking', 'computer networking, Wi-Fi, mesh networks, network engineering', ['networking', 'BGP', 'DNS', 'Wi-Fi', 'mesh network', 'network engineering', 'TCP/IP']),
  topic('Mechanical Keyboards', 'mechanical keyboards, custom keyboards, keycaps, switches', ['mechanical keyboard', 'keycap', 'cherry mx', 'custom keyboard', 'thock', 'switches']),
];

// ─── Science ────────────────────────────────────────────────────────────────

const science: SystemFeedDef[] = [
  topic('Climate Science', 'climate change research, global warming data, environmental science', ['climate', 'climate change', 'global warming', 'greenhouse', 'carbon', 'IPCC', 'sea level']),
  topic('Space Exploration', 'space missions, NASA, SpaceX, astronomy, cosmology', ['space', 'NASA', 'SpaceX', 'astronomy', 'rocket', 'Mars', 'moon', 'ISS', 'James Webb']),
  topic('Neuroscience', 'brain research, neuroscience discoveries, cognitive science', ['neuroscience', 'brain', 'cognitive', 'neurology', 'neural', 'consciousness']),
  topic('Biology & Genetics', 'genetics, genomics, CRISPR, evolutionary biology', ['genetics', 'genomics', 'CRISPR', 'DNA', 'gene editing', 'biology', 'evolution']),
  topic('Physics', 'physics research, quantum mechanics, particle physics, astrophysics', ['physics', 'quantum', 'particle physics', 'CERN', 'relativity', 'astrophysics']),
  topic('Marine Biology', 'ocean science, marine life, oceanography, coral reefs', ['marine biology', 'ocean', 'coral reef', 'marine life', 'oceanography', 'deep sea']),
  topic('Archaeology', 'archaeological discoveries, ancient civilizations, historical findings', ['archaeology', 'archaeological', 'ancient', 'excavation', 'artifact', 'fossil']),
  topic('Psychology', 'psychology research, mental health science, behavioral studies', ['psychology', 'mental health', 'behavioral', 'cognitive psychology', 'therapy research']),
];

// ─── Sports ─────────────────────────────────────────────────────────────────

const sports: SystemFeedDef[] = [
  broad('NBA', 'NBA basketball news, scores, trades, and analysis', ['NBA', 'basketball', 'Lakers', 'Celtics', 'Warriors', 'Knicks', 'dunk', 'three pointer']),
  broad('NFL', 'NFL football news, scores, trades, draft, and analysis', ['NFL', 'football', 'touchdown', 'quarterback', 'Super Bowl', 'draft pick']),
  broad('MLB', 'Major League Baseball news, scores, trades', ['MLB', 'baseball', 'home run', 'pitcher', 'World Series', 'batting']),
  broad('Premier League', 'English Premier League football/soccer news and match results', ['premier league', 'EPL', 'football', 'Manchester United', 'Liverpool', 'Arsenal', 'Chelsea']),
  broad('Formula 1', 'Formula 1 racing news, race results, team updates', ['F1', 'formula 1', 'grand prix', 'FIA', 'Verstappen', 'Hamilton', 'Ferrari', 'Red Bull Racing']),
  broad('UFC & MMA', 'UFC fights, MMA news, fighter updates', ['UFC', 'MMA', 'mixed martial arts', 'fight night', 'knockout', 'submission']),
  broad('Tennis', 'professional tennis news, Grand Slams, ATP, WTA', ['tennis', 'ATP', 'WTA', 'Grand Slam', 'Wimbledon', 'US Open', 'Roland Garros']),
  broad('Golf', 'professional golf news, PGA Tour, majors', ['golf', 'PGA', 'Masters', 'birdie', 'eagle', 'links']),
  broad('NHL', 'NHL hockey news, scores, trades, Stanley Cup', ['NHL', 'hockey', 'Stanley Cup', 'hat trick', 'power play']),
  broad('Soccer', 'global soccer/football news, Champions League, World Cup', ['soccer', 'football', 'Champions League', 'World Cup', 'FIFA', 'La Liga', 'Bundesliga', 'Serie A']),
  topic('Running & Marathons', 'running community, marathon training, ultramarathons, trail running', ['running', 'marathon', 'ultramarathon', 'trail running', '5K', '10K', 'half marathon']),
  topic('Cycling', 'road cycling, mountain biking, Tour de France, gravel racing', ['cycling', 'bicycle', 'Tour de France', 'gravel', 'mountain bike', 'MTB', 'peloton']),
  topic('Climbing', 'rock climbing, bouldering, mountaineering community', ['climbing', 'bouldering', 'mountaineering', 'trad climbing', 'sport climbing']),
  topic('Swimming', 'competitive swimming, open water, triathlon', ['swimming', 'triathlon', 'open water', 'freestyle', 'backstroke']),
  topic('Fantasy Sports', 'fantasy football, fantasy basketball, DFS, sports betting strategy', ['fantasy football', 'fantasy basketball', 'DFS', 'draft kings', 'fanduel', 'fantasy sports']),
  topic('Esports', 'competitive gaming, esports tournaments, League of Legends, Valorant', ['esports', 'competitive gaming', 'League of Legends', 'Valorant', 'CS2', 'Dota', 'tournament']),
];

// ─── Finance & Business ────────────────────────────────────────────────────

const finance: SystemFeedDef[] = [
  broad('Stock Market', 'stock market news, earnings reports, market analysis', ['stock market', 'S&P 500', 'Nasdaq', 'Dow Jones', 'earnings', 'IPO', 'NYSE']),
  topic('Cryptocurrency', 'cryptocurrency markets, Bitcoin, Ethereum, DeFi, blockchain technology', ['crypto', 'bitcoin', 'ethereum', 'DeFi', 'blockchain', 'NFT', 'web3']),
  topic('Personal Finance', 'personal finance tips, budgeting, investing for beginners, FIRE movement', ['personal finance', 'budgeting', 'investing', 'FIRE', 'retirement', 'savings', '401k', 'index fund']),
  topic('Real Estate', 'real estate market trends, housing prices, mortgage rates', ['real estate', 'housing', 'mortgage', 'property', 'home prices', 'rent']),
  topic('Startups', 'startup news, venture capital, fundraising, Y Combinator', ['startup', 'venture capital', 'VC', 'fundraising', 'seed round', 'YC', 'founder']),
  topic('Economics', 'economic analysis, macroeconomics, monetary policy, inflation', ['economics', 'inflation', 'Federal Reserve', 'GDP', 'recession', 'monetary policy', 'interest rate']),
  topic('Fintech', 'financial technology, neobanks, payment processing, banking innovation', ['fintech', 'neobank', 'payment', 'stripe', 'square', 'banking']),
];

// ─── Culture & Entertainment ────────────────────────────────────────────────

const culture: SystemFeedDef[] = [
  topic('Book Reviews', 'book reviews, literature discussions, new releases, reading community', ['book review', 'literature', 'novel', 'reading', 'bookclub', 'fiction', 'nonfiction', 'TBR']),
  topic('Film Criticism', 'movie reviews, film criticism, cinema analysis, new releases', ['film', 'movie', 'cinema', 'review', 'director', 'screenplay', 'Letterboxd']),
  topic('TV Shows', 'television series discussions, streaming shows, new seasons', ['TV show', 'television', 'streaming', 'Netflix', 'HBO', 'series finale']),
  topic('Hip Hop', 'hip hop music news, rap releases, beats, hip hop culture', ['hip hop', 'rap', 'rapper', 'beat', 'album drop', 'hip hop culture']),
  topic('Indie Music', 'independent music, indie rock, DIY music scene, Bandcamp', ['indie music', 'indie rock', 'bandcamp', 'DIY music', 'underground', 'indie pop']),
  topic('Podcasting', 'podcasting tips, podcast recommendations, audio production', ['podcast', 'podcasting', 'audio', 'episode', 'RSS feed', 'podcast app']),
  topic('Comics & Manga', 'comic books, manga, graphic novels, sequential art', ['comics', 'manga', 'graphic novel', 'Marvel', 'DC Comics', 'webtoon']),
  topic('Anime', 'anime news, seasonal anime, anime reviews', ['anime', 'manga', 'seasonal anime', 'Crunchyroll', 'Studio Ghibli', 'shonen', 'seinen']),
  topic('Board Games', 'board game reviews, tabletop gaming, game design', ['board game', 'tabletop', 'TTRPG', 'Dungeons and Dragons', 'game night', 'BGG']),
  topic('Video Games', 'video game news, reviews, releases across all platforms', ['video game', 'gaming', 'PlayStation', 'Xbox', 'Nintendo', 'Steam', 'PC gaming']),
  topic('Photography', 'photography techniques, camera gear, photo sharing community', ['photography', 'camera', 'photo', 'lens', 'Fujifilm', 'Sony', 'Canon', 'Nikon', 'street photography']),
  topic('Art & Illustration', 'digital art, illustration, visual arts community', ['art', 'illustration', 'digital art', 'painting', 'drawing', 'sketch', 'watercolor']),
];

// ─── Lifestyle ──────────────────────────────────────────────────────────────

const lifestyle: SystemFeedDef[] = [
  topic('Cooking & Recipes', 'cooking tips, recipes, food culture, culinary techniques', ['cooking', 'recipe', 'culinary', 'baking', 'kitchen', 'chef', 'homemade']),
  topic('Sourdough', 'sourdough baking, bread making, fermentation, starter maintenance', ['sourdough', 'bread', 'starter', 'crumb', 'fermentation', 'levain']),
  topic('Coffee', 'coffee brewing, specialty coffee, espresso, café culture', ['coffee', 'espresso', 'latte', 'pour over', 'specialty coffee', 'café', 'barista']),
  topic('Craft Beer', 'craft beer brewing, brewery news, beer reviews, homebrewing', ['craft beer', 'brewery', 'IPA', 'stout', 'homebrew', 'ale', 'hops']),
  topic('Wine', 'wine tasting, vineyards, wine regions, sommelier insights', ['wine', 'vineyard', 'winery', 'sommelier', 'cabernet', 'pinot noir', 'rosé']),
  topic('Gardening', 'gardening tips, plant care, urban gardening, permaculture', ['gardening', 'garden', 'plants', 'permaculture', 'composting', 'vegetable garden', 'houseplants']),
  topic('Fitness', 'fitness training, workout routines, strength training, health', ['fitness', 'workout', 'gym', 'strength training', 'CrossFit', 'weightlifting', 'exercise']),
  topic('Yoga & Meditation', 'yoga practice, meditation, mindfulness, wellness', ['yoga', 'meditation', 'mindfulness', 'wellness', 'breathwork', 'asana']),
  topic('Hiking & Outdoors', 'hiking trails, outdoor adventures, camping, national parks', ['hiking', 'outdoors', 'camping', 'national park', 'trail', 'backpacking', 'nature']),
  topic('Travel', 'travel experiences, destination guides, backpacking, digital nomad', ['travel', 'backpacking', 'destination', 'digital nomad', 'wanderlust', 'hostel']),
  topic('Parenting', 'parenting advice, child development, family life', ['parenting', 'parent', 'child', 'baby', 'toddler', 'family']),
  topic('Pets & Dogs', 'dog ownership, pet care, animal welfare', ['dog', 'puppy', 'pet', 'rescue dog', 'veterinary', 'animal welfare']),
  topic('Cats', 'cat ownership, feline behavior, cat photos', ['cat', 'kitten', 'feline', 'meow', 'cat behavior']),
];

// ─── Professional / Industry ───────────────────────────────────────────────

const professional: SystemFeedDef[] = [
  topic('Product Management', 'product management insights, roadmaps, user research, PM career', ['product management', 'product manager', 'roadmap', 'user research', 'PM', 'agile', 'scrum']),
  topic('UX Design', 'user experience design, interaction design, design systems', ['UX', 'user experience', 'interaction design', 'design system', 'usability', 'wireframe', 'Figma']),
  topic('Data Science', 'data science techniques, analytics, data engineering, ML ops', ['data science', 'analytics', 'data engineering', 'MLOps', 'pandas', 'spark', 'jupyter']),
  topic('Marketing', 'digital marketing, SEO, content marketing, growth strategies', ['marketing', 'SEO', 'content marketing', 'growth', 'social media marketing', 'brand']),
  topic('Education', 'education technology, teaching methods, higher education, EdTech', ['education', 'teaching', 'EdTech', 'learning', 'university', 'classroom', 'pedagogy']),
  topic('Journalism', 'journalism industry, press freedom, media criticism, newsrooms', ['journalism', 'journalist', 'press freedom', 'newsroom', 'media', 'reporter', 'investigative']),
  topic('Legal & Law', 'legal news, court decisions, law practice, constitutional law', ['legal', 'law', 'court', 'SCOTUS', 'lawsuit', 'attorney', 'constitutional']),
  topic('Healthcare', 'healthcare industry, medical news, public health, health policy', ['healthcare', 'medical', 'public health', 'hospital', 'doctor', 'nurse', 'health policy']),
  topic('Architecture', 'architecture and urban design, buildings, city planning', ['architecture', 'architect', 'urban design', 'city planning', 'building', 'zoning']),
  topic('Remote Work', 'remote work tips, distributed teams, work from home culture', ['remote work', 'WFH', 'distributed team', 'work from home', 'coworking', 'async']),
];

// ─── Politics & Policy ─────────────────────────────────────────────────────

const politics: SystemFeedDef[] = [
  broad('US Politics', 'United States political news, Congress, White House, elections', ['congress', 'senate', 'house of representatives', 'White House', 'election', 'POTUS', 'legislation']),
  topic('EU Policy', 'European Union policy, regulations, European Parliament', ['EU', 'European Union', 'European Parliament', 'Brussels', 'Eurozone', 'EU regulation']),
  topic('UK Politics', 'British politics, Parliament, Labour, Conservatives', ['UK politics', 'parliament', 'Westminster', 'Labour', 'Tories', 'prime minister']),
  topic('Climate Policy', 'climate policy and legislation, green energy policy, environmental regulation', ['climate policy', 'green new deal', 'carbon tax', 'renewable energy policy', 'Paris agreement']),
  topic('Tech Policy', 'technology regulation, antitrust, Section 230, digital governance', ['tech policy', 'antitrust', 'Section 230', 'tech regulation', 'FTC', 'GDPR', 'AI regulation']),
  topic('Labor & Unions', 'labor movement, unions, workers rights, strikes', ['labor', 'union', 'strike', 'workers rights', 'collective bargaining', 'wage']),
  topic('Immigration', 'immigration policy, border issues, visa systems, refugee news', ['immigration', 'border', 'visa', 'refugee', 'asylum', 'immigration reform']),
  topic('Housing Policy', 'housing policy, zoning reform, affordable housing, YIMBY', ['housing policy', 'zoning', 'affordable housing', 'YIMBY', 'NIMBY', 'rent control']),
];

// ─── Environment & Sustainability ──────────────────────────────────────────

const environment: SystemFeedDef[] = [
  topic('Renewable Energy', 'solar, wind, battery technology, clean energy transition', ['solar', 'wind power', 'battery', 'renewable energy', 'clean energy', 'EV', 'electric vehicle']),
  topic('Electric Vehicles', 'electric cars, EV charging, Tesla, Rivian, EV market', ['electric vehicle', 'EV', 'Tesla', 'Rivian', 'charging station', 'EV battery', 'electric car']),
  topic('Sustainability', 'sustainable living, zero waste, circular economy', ['sustainability', 'zero waste', 'circular economy', 'eco-friendly', 'sustainable']),
  topic('Urban Planning', 'city planning, public transit, walkable cities, bike infrastructure', ['urban planning', 'public transit', 'walkable', 'bike lane', 'city design', 'zoning']),
  topic('Bird Watching', 'birding, bird identification, ornithology, migration', ['birding', 'bird watching', 'ornithology', 'bird', 'migration', 'species']),
  topic('National Parks', 'national parks, conservation, wilderness preservation', ['national park', 'conservation', 'wilderness', 'NPS', 'preservation', 'public lands']),
];

// ─── Combine All ────────────────────────────────────────────────────────────

export const RESEARCH_FEEDS: SystemFeedDef[] = [
  ...usTier1,
  ...usTier2,
  ...usRegions,
  ...international,
  ...technology,
  ...science,
  ...sports,
  ...finance,
  ...culture,
  ...lifestyle,
  ...professional,
  ...politics,
  ...environment,
];
