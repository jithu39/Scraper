# 🎓 UoH Alumni Scraper

A powerful web scraping tool for extracting alumni data from the University of Hyderabad portal. Built with Puppeteer and Express, featuring a modern web UI with real-time data display, pagination, and advanced filtering.

## ✨ Features

 **Automated Login** — Credential-based portal authentication  
 **Real-time Scraping** — Watch data populate live as it's extracted  
 **Advanced Filtering** — Filter by degree, year, location, and search  
 **Smart Pagination** — View 40 profiles per page  
 **CSV Export** — Download filtered results with one click  
 **Professional UI** — Modern dashboard with smooth animations  
 **Deduplication** — Intelligent removal of duplicate records  
 **Graceful Shutdown** — Saves progress on Ctrl+C  
 **Error Recovery** — Auto-recovery from network failures  
 **Live Dashboard** — Real-time status and scrape log  

## 🛠 Tech Stack

- **Backend**: Node.js + Express.js
- **Browser Automation**: Puppeteer-core
- **Environment Management**: dotenv
- **Frontend**: HTML5 + CSS3 + Vanilla JavaScript
- **Data Format**: CSV (auto-deduplicated)

## 🚀 Quick Start

### Prerequisites

- Node.js 14+
- npm
- Chrome/Chromium browser (auto-detected)
- University of Hyderabad alumni portal credentials

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/uohyd-alumni-scraper.git
cd uohyd-alumni-scraper

# Install dependencies
npm install

# Create environment file
cp .env.example .env
```

### Configuration

Edit `.env` with your credentials:

```env
LOGIN_EMAIL=your-email@uohyd.ac.in
LOGIN_PASSWORD=your-password
PORT=3000
UOH_ALUMNI_URL=https://alumni.uohyd.ac.in/members
CHROME_PATH=/usr/bin/google-chrome-stable
```

### Run

```bash
npm start
```

Open http://localhost:3000 in your browser

## 📖 Usage

### Via Web UI

1. Visit http://localhost:3000
2. (Optional) Enter email and password
3. Click **Start Scrape**
4. Watch real-time updates every 2 seconds
5. Use filters to search and organize results
6. Navigate pages with Previous/Next buttons
7. Export filtered data as CSV

### Via API

**Start scraping:**
```bash
curl -X POST http://localhost:3000/api/scrape \
  -H "Content-Type: application/json" \
  -d '{"LOGIN_EMAIL":"user@uohyd.ac.in","LOGIN_PASSWORD":"password"}'
```

**Fetch results:**
```bash
curl http://localhost:3000/api/results
```

**Stop scraping:**
```bash
curl -X POST http://localhost:3000/api/stop
```

## 📁 Project Structure

```
uohyd-alumni-scraper/
├── server.js              # Express server + Puppeteer logic
├── public/
│   └── index.html        # Web UI with embedded CSS & JS
├── package.json          # Dependencies
├── .env.example          # Environment template
├── .gitignore           # Git ignore rules
├── uoh_alumni_data.csv  # Generated alumni data
└── README.md            # Documentation
```

## 🎯 Key Features Explained

### Real-time Updates
- Results refresh every 2 seconds during scraping
- See profile count update in real-time
- Live scrape log with all activities

### Pagination
- 40 profiles per page (customizable)
- Next/Previous buttons for navigation
- Page indicator with total count

### Filtering Options
- **Search**: Filter by name, degree, company, location
- **Degree**: Select specific degree/course
- **Year**: Filter by graduation year
- **Location**: Filter by city/location
- **Clear**: Reset all filters at once

### Export
- Download filtered results as CSV
- Properly formatted with quoted fields
- Can export full dataset or filtered subset

## 📊 Data Schema

Each alumni record contains:

| Field | Type | Description |
|-------|------|-------------|
| `name` | String | Full name |
| `degree` | String | Degree/Course name |
| `company` | String | Company/Organization |
| `gradYear` | String | Graduation year (YYYY) |
| `location` | String | City/Location |

## ⚙️ API Endpoints

### GET `/api/results`
Fetch all alumni data from CSV.

**Response:**
```json
{
  "results": [
    {
      "name": "John Doe",
      "degree": "Computer Science",
      "company": "Tech Corp",
      "gradYear": "2024",
      "location": "Hyderabad"
    }
  ]
}
```

### POST `/api/scrape`
Start a scraping session.

**Request:**
```json
{
  "LOGIN_EMAIL": "user@uohyd.ac.in",
  "LOGIN_PASSWORD": "password"
}
```

**Response:**
```json
{
  "success": true,
  "count": 150,
  "output": "Scraped 150 alumni profiles."
}
```

### POST `/api/stop`
Stop an ongoing scrape.

## 🔧 Configuration

### Change Items Per Page

Edit `public/index.html`:

```javascript
const ITEMS_PER_PAGE = 40;  // Change to desired value
```

### Set Chrome Path

If auto-detection fails, set in `.env`:

```env
CHROME_PATH=/usr/bin/chromium-browser
```

## ⚠️ Important Notes

1. **Keep .env Secure**: Never commit `.env` to git (already in `.gitignore`)
2. **Respect Terms of Service**: Ensure scraping complies with university policies
3. **Data Privacy**: Handle extracted personal data responsibly
4. **Browser Required**: Install Chrome/Chromium if not present:
   ```bash
   sudo apt-get install chromium  # Linux
   brew install chromium          # macOS
   ```

## 🐛 Troubleshooting

### Chrome Not Found
```bash
export CHROME_PATH=/path/to/chrome
npm start
```

### Network Timeouts
The scraper implements auto-retry logic with increasing timeouts. If issues persist:
- Check internet connection
- Verify university portal is accessible
- Reduce number of categories being scraped

### CSV File Corruption
Delete and start fresh:
```bash
rm uoh_alumni_data.csv
npm start  # Will recreate on next scrape
```

### Port Already in Use
```bash
lsof -i :3000  # Find process
kill -9 <PID>   # Kill process
npm start
```

## 📈 Performance

- Sequential category processing (one at a time)
- Auto-scroll for lazy-loaded content
- Automatic retry on network failures
- Graceful page recovery
- Efficient CSV streaming

## 🤝 Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

MIT License © 2026 - See LICENSE file for details

## ⚖️ Disclaimer

This tool is for **educational purposes only**. Users are responsible for:
- Compliance with university terms of service
- Handling personal data responsibly
- Respecting privacy regulations
