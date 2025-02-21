# cf-owntracks

cf-owntracks is a location tracking server implementation based on Cloudflare Workers, inspired by the [OwnTracks](https://owntracks.org/) project. Compared to the original OwnTracks which requires self-hosting a server, this project leverages the advantages of Cloudflare Workers to provide a low-cost, easy-to-deploy, highly available, and high-performance alternative.

## Features

- 🚀 Based on Cloudflare Workers, no need to self-host a server
- 💾 Uses R2 to store location data, low cost
- 🔒 Built-in Basic Auth protection
- ⚡ Distributed via global edge network, low latency
- 📱 Fully compatible with OwnTracks client
- 🔍 Supports historical location queries
- 📍 Supports real-time location updates

## Quick Start

### Prerequisites

- Cloudflare account
- Node.js 16+
- npm or yarn
- wrangler CLI

### Installation

1. Clone the repository:

```bash
git clone https://github.com/yourusername/cf-owntracks.git
cd cf-owntracks
```

2. Install dependencies:

```bash
npm install
```

3. Configure `wrangler.toml`:

```toml
name = "owntracker-worker"
main = "src/index.ts"

[[r2_buckets]]
binding = "STORAGE"
bucket_name = "your-bucket-name"

[[kv_namespaces]]
binding = "LAST_LOCATIONS"
id = "your-kv-namespace-id"

[vars]
BASIC_AUTH_USER = "your-username"
BASIC_AUTH_PASS = "your-password"
```

4. Deploy:

```bash
npm run deploy
```

## API Endpoints

### Location Reporting
- `POST /`
	- Receives location updates from OwnTracks client

### Query Endpoints
- `GET /api/0/locations` - Query historical locations
- `GET /api/0/last` - Get the latest location
- `GET /api/0/list` - List users and devices
- `GET /api/0/version` - Get version information

## Client Configuration

1. Download and install the [OwnTracks](https://owntracks.org/) client
2. Configure connection information:
	- Mode: HTTP
	- URL: Your Worker URL
	- Authentication: Basic
	- Username: The username you set
	- Password: The password you set

## Cost Advantages

- Cloudflare Workers: 100,000 requests free per day
- R2 Storage: First 10GB free per month
- KV Storage: Free tier sufficient for general use

## Contribution

Issues and Pull Requests are welcome!

## Acknowledgements

Thanks to the [OwnTracks](https://owntracks.org/) project.
