# AlIAs

## About

AlIAs is an AI-powered application that generates phonetically similar name variations. Initially focused on people's names, it's particularly useful for:
- Finding alternative spellings of names
- Enhancing search capabilities for people lookup
- Supporting research and data analysis

## Use Cases

- Generate phonetic name variations for more effective searches
- Complement people search in Peru (full names, ID numbers, birth dates, etc.)
- Tool for researchers and professionals working with name variations

## Features

- AI-powered phonetic variation generation
- User-friendly interface
- Customizable search parameters
- Support for international name formats

## Getting Started

1. Clone the repository
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env` and update the values:
   ```
   cp .env.example .env
   ```
4. Start the server: `npm start`
5. Open `http://localhost:3000` in your browser

## Configuration

Required environment variables:

- `API_KEY`: Your Gemini API key for AI functionality
- `REDIS_URL`: Redis connection URL (defaults to `redis://localhost:6379` if not set)
- `CACHE_TTL_SECONDS`: Cache time-to-live in seconds (default: 604800 - 1 week)

Example `.env` file:
```
API_KEY=your_gemini_api_key_here
REDIS_URL=redis://localhost:6379
CACHE_TTL_SECONDS=604800
```

## How to Contribute

We welcome contributions! If you'd like to help improve AlIAs:

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

Distributed under the MIT License. See `LICENSE` for more information.
