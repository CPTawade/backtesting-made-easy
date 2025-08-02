from flask import Flask, jsonify, request, render_template
import yfinance as yf
import requests

app = Flask(__name__)

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/api/candles', methods=['GET'])
@app.route('/api/candles/', methods=['GET'])
def get_candles():
    print('HIT /api/candles', flush=True)
    return jsonify({'result': 'candles endpoint hit!'})

@app.route('/api/test')
def test_api():
    return jsonify({'result': 'API test route works!'})

@app.route('/api/search_symbol')
def search_symbol():
    query = request.args.get('q', '').strip()
    if not query:
        return jsonify({'quotes': []})
    try:
        url = f'https://query2.finance.yahoo.com/v1/finance/search?q={query}&quotesCount=50&newsCount=0'
        headers = {'User-Agent': 'Mozilla/5.0'}
        resp = requests.get(url, timeout=5, headers=headers)
        return jsonify(resp.json())
    except Exception as e:
        print(f'[ERROR] Symbol search failed: {e}')
        return jsonify({'quotes': [], 'error': 'Failed to fetch suggestions'}), 500

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found', 'hint': 'This is a Flask 404, so Flask is running.'}), 404

if __name__ == '__main__':
    app.run(debug=True, port=8000)

