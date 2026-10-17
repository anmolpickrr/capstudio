"""A stand-in for Groq's transcription API, for testing a full deployment
without a real key. Usage: python tests/mock_groq.py [port]
Then run the app with GROQ_API_KEY=anything GROQ_API_BASE=http://<host>:<port>/openai/v1"""
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

TEXT = ("Hey everyone, welcome back to the channel. Today I'm going to show you how to organize "
        "your favorite videos with colour-perfect captions. Let's get started!")


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers.get("content-length", 0)))
        tokens = TEXT.split()
        words = [{"word": t.strip(".,!").lower(), "start": 0.5 + i * 0.3, "end": 0.75 + i * 0.3}
                 for i, t in enumerate(tokens)]
        body = json.dumps({"language": "english", "segments": [{"text": " " + TEXT, "avg_logprob": -0.3}],
                           "words": words}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


HTTPServer(("0.0.0.0", int(sys.argv[1]) if len(sys.argv) > 1 else 9555), Handler).serve_forever()
