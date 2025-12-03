# AlIAs - Unified People Search Interface

AlIAs is an intermediary service that simplifies searching for individuals across multiple sources. We provide a single, unified interface for querying different data sources using names or national ID numbers (DNI) in Peru.

> **Important Note**: AlIAs is an intermediary layer that facilitates searches across various sources. We do not store or own the data but provide a convenient way to access multiple sources from a single platform.

## Main Features

- **Unified Search Interface**: Query multiple sources through a single API
- **Flexible Search Options**:
  - Search by national ID number (DNI)
  - Search by full name (first and last names)
- **Multi-source Integration**: Automatically queries relevant sources
- **Standardized Results**: Consistent response format across different data sources
- **Name Variation Tool**: Generate common name variations for broader searches

## How It Works

1. **Request Reception**: Receive search queries through our API
2. **Source Routing**: Intelligently route queries to appropriate sources
3. **Data Aggregation**: Combine and standardize results from multiple sources
4. **Response Delivery**: Return unified, consistent results to the client

## Technical Features

- **Hybrid Architecture**: Deploy as a traditional server or serverless function
- **Flexible Deployment**: Run on any Node.js environment or serverless platforms
- **High Performance**: Optimized for fast responses with Redis caching
- **Scalable**: Handles both low and high traffic scenarios
- **Well-documented**: Comprehensive RESTful API documentation

## Prerequisites

- Node.js 16+
- npm or pnpm
- Configured environment variables (see `.env.example`)

## Installation

1. Clone the repository
2. Install dependencies: `pnpm install`
3. Copy `.env.example` to `.env` and configure the environment variables
4. Start the server: `pnpm run dev`

## Usage

### Search by ID (DNI)
```
POST /api/scrape-data-dni
{
  "dni": "12345678"
}
```

### Search by Name
```
POST /api/scrape-data-dni-peru
{
  "name": "JOHN",
  "fatherLastName": "SMITH",
  "motherLastName": "JOHNSON"
}
```

## Name Variation Tool

AlIAs includes a separate name variation generation tool that can be used independently:

```
POST /api/generate-names
{
  "name": "John Smith",
  "limit": 5
}
```

This tool is useful for generating common name variations that might be used in different contexts or platforms.

## Deployment Options

### Option 1: Traditional Server
1. Clone the repository
2. Install dependencies: `pnpm install`
3. Configure environment variables in `.env`
4. Start the server: `pnpm run dev` (development) or `node server.js` (production)

### Option 2: Serverless Deployment
1. Use the individual API endpoints located in the `/api` directory
2. Each file in `/api` is a self-contained serverless function
3. Deploy these functions to your preferred serverless platform
4. Configure the required environment variables in your platform's settings

### Environment Variables

Create a `.env` file with the following variables:

```env
# Server Configuration
PORT=3000  # Not required in serverless environments
NODE_ENV=development

# Cache Configuration (optional)
REDIS_URL=your_redis_url
CACHE_TTL_SECONDS=604800  # 1 week

# API Keys
GOOGLE_API_KEY=your_google_api_key

# Serverless Configuration
# Set to true when deploying as a serverless function
IS_SERVERLESS=false

# CORS Configuration (if needed)
ALLOWED_ORIGINS=*  # Restrict to specific domains in production
```

> **Note for Serverless**: In serverless environments, you'll need to set these variables in your platform's configuration, not in a `.env` file.

## Suggested Improvements

1. **Security**:
   - Implement JWT authentication for API endpoints
   - Add rate limiting to prevent abuse
   - Stricter input validation

2. **Performance**:
   - Enhance caching system with dynamic TTL
   - Optimize data server queries
   - Implement a queue system for asynchronous processing

3. **Features**:
   - Add support for partial searches
   - Implement fingerprint-based search
   - Add advanced search filters
   - Support for multiple output formats (JSON, CSV, XML)

4. **Documentation**:
   - Detailed API documentation with examples
   - Contribution guidelines
   - Implementation examples for different languages

## Contributing

Contributions are welcome! Please open an issue or submit a pull request with your improvements.
