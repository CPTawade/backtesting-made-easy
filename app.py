from flask import Flask, jsonify, request, render_template
import yfinance as yf
import requests

app = Flask(__name__)

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/api/candles')
def get_candles():
    symbol = request.args.get('symbol', default='AAPL', type=str)
    interval = request.args.get('interval', default='1d', type=str)  # e.g. '1d', '1h'
    print(f"[INFO] /api/candles called with symbol={symbol}, interval={interval}")
    try:
        # Validate interval
        valid_intervals = ['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h', '1d', '1wk', '1mo']
        if interval not in valid_intervals:
            return jsonify({'error': f'Invalid interval: {interval}. Valid intervals are: {', '.join(valid_intervals)}'}), 400
        # Automatically limit period for intraday intervals
        intraday_intervals = ['1m', '2m', '5m', '15m', '30m', '60m', '90m']
        if interval in intraday_intervals:
            period = '60d'
        else:
            period = 'max'
        data = yf.download(tickers=symbol, period=period, interval=interval)
        if data is None or data.empty:
            return jsonify({'error': f'No data found for symbol "{symbol}" or interval "{interval}".\n\n- Make sure the symbol is valid (e.g., TCS.NS, RELIANCE.NS, AAPL).\n- For intraday intervals, Yahoo only provides up to 60 days of data and not all symbols are supported.'}), 404
        # Handle new yfinance DataFrame structure (multi-level columns)
        # If columns are MultiIndex, select columns where first level is attribute
        if hasattr(data.columns, 'levels') and len(data.columns.levels) == 2:
            # E.g., columns like ('Close', 'TCS.NS'), ('Open', 'TCS.NS'), etc.
            ticker_level = symbol.upper()
            # Select columns for this ticker
            try:
                data = data.xs(ticker_level, axis=1, level=1)
            except Exception as e:
                print(f"[ERROR] Could not select columns for ticker {ticker_level}: {e}")
                return jsonify({'error': f'Data for symbol "{symbol}" is missing or malformed.'}), 500
        # Check required columns
        required_cols = {'Open', 'High', 'Low', 'Close', 'Volume'}
        if not required_cols.issubset(set(data.columns)):
            return jsonify({'error': f'Data for symbol "{symbol}" is missing required columns. Try a different symbol or interval.'}), 500
        # --- EMA Crossover Strategy ---
        import pandas as pd
        ema1 = int(request.args.get('ema_short', 20))
        ema2 = int(request.args.get('ema_long', 50))
        smaller_length = min(ema1, ema2)
        bigger_length = max(ema1, ema2)
        df = data.copy()
        df['EMA_smaller'] = df['Close'].ewm(span=smaller_length, adjust=False).mean()
        df['EMA_bigger'] = df['Close'].ewm(span=bigger_length, adjust=False).mean()
        df['Signal'] = 0
        df.loc[(df['EMA_smaller'] > df['EMA_bigger']) & (df['EMA_smaller'].shift() <= df['EMA_bigger'].shift()), 'Signal'] = 1
        df.loc[(df['EMA_smaller'] < df['EMA_bigger']) & (df['EMA_smaller'].shift() >= df['EMA_bigger'].shift()), 'Signal'] = -1

        # Prepare data for frontend
        candles = []
        signals = []
        for idx, row in df.iterrows():
            try:
                t = int(idx.timestamp())
                candles.append({
                    'time': t,
                    'open': float(row['Open']),
                    'high': float(row['High']),
                    'low': float(row['Low']),
                    'close': float(row['Close']),
                    'volume': float(row['Volume'])
                })
                if row['Signal'] == 1:
                    signals.append({'time': t, 'signal': 'buy', 'price': float(row['Close'])})
                elif row['Signal'] == -1:
                    signals.append({'time': t, 'signal': 'sell', 'price': float(row['Close'])})
            except Exception as row_err:
                print(f"[ERROR] Malformed row at {idx}: {row_err}")
        if not candles:
            return jsonify({'error': f'No valid candle data found for symbol "{symbol}" and interval "{interval}".'}), 404
        return jsonify({'candles': candles, 'signals': signals})
    except Exception as e:
        import traceback
        print('Exception in /api/candles:', e)
        traceback.print_exc()
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

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

if __name__ == '__main__':
    app.run(debug=True, port=8000)

