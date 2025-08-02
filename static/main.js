// main.js - Handles fetching data and rendering chart

let chart = null;
let candleSeries = null;

// --- Company Name Autocomplete ---
const companyInput = document.getElementById('company-search');
const symbolInput = document.getElementById('symbol');
const autocompleteList = document.getElementById('autocomplete-list');

let debounceTimeout = null;
companyInput.addEventListener('input', function() {
    const query = this.value.trim();
    if (debounceTimeout) clearTimeout(debounceTimeout);
    if (!query) {
        autocompleteList.style.display = 'none';
        autocompleteList.innerHTML = '';
        return;
    }
    debounceTimeout = setTimeout(() => {
        fetch(`/api/search_symbol?q=${encodeURIComponent(query)}`)
            .then(resp => resp.json())
            .then(data => {
                if (data.quotes && data.quotes.length > 0) {
                    // Filter: Only show items with a readable company name (shortname or longname), exclude symbols like '0P...' or ending with '.BO'
                    const filtered = data.quotes.filter(item => {
                        const displayName = item.shortname || item.longname;
                        // Exclude if no readable name, or if symbol looks like a code
                        if (!displayName) return false;
                        if (/^0P/i.test(item.symbol) || /\.BO$/i.test(item.symbol)) return false;
                        return true;
                    });
                    autocompleteList.innerHTML = filtered.map(item => {
                        const displayName = item.shortname || item.longname;
                        return `<div class='autocomplete-item' style='padding:2px 8px;cursor:pointer;border-bottom:1px solid #eee;font-size:13px;line-height:1.3;width:270px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' data-symbol='${item.symbol}'>${displayName}</div>`;
                    }).join('');
                    autocompleteList.style.display = 'block';
                } else {
                    autocompleteList.innerHTML = `<div style='padding:6px;color:#888;'>No matches found</div>`;
                    autocompleteList.style.display = 'block';
                }
            })
            .catch(() => {
                autocompleteList.innerHTML = `<div style='padding:6px;color:#888;'>Error fetching suggestions</div>`;
                autocompleteList.style.display = 'block';
            });
    }, 300);
});

autocompleteList.addEventListener('mousedown', function(e) {
    if (e.target && e.target.matches('.autocomplete-item')) {
        const symbol = e.target.getAttribute('data-symbol');
        const name = e.target.textContent;
        symbolInput.value = symbol;
        companyInput.value = name.replace(/\s*\(.+\)$/, '');
        autocompleteList.style.display = 'none';
        autocompleteList.innerHTML = '';
    }
});

document.addEventListener('click', function(e) {
    if (!autocompleteList.contains(e.target) && e.target !== companyInput) {
        autocompleteList.style.display = 'none';
    }
});

function createChart() {
    if (chart) chart.remove(); // Remove old chart if exists
    chart = LightweightCharts.createChart(document.getElementById('chart'), {
        width: 1200,
        height: 600,
        layout: { background: { color: '#fff' }, textColor: '#333' },
        grid: { vertLines: { color: '#eee' }, horzLines: { color: '#eee' } },
    });
    candleSeries = chart.addCandlestickSeries();
}

async function loadChart() {
    const symbol = document.getElementById('symbol').value.trim();
    const interval = document.getElementById('interval').value;

    // Defensive checks
    if (!symbol || !interval) {
        alert('Please enter a valid symbol and select an interval.');
        return;
    }
    // Do not clear chart div manually; let Lightweight Charts handle chart removal.

    createChart();
    console.log('Requesting:', symbol, interval);
    try {
        let biggerEMA = parseInt(document.getElementById('fast-ema').value, 10);
        let smallerEMA = parseInt(document.getElementById('slow-ema').value, 10);
        if (isNaN(biggerEMA) || isNaN(smallerEMA) || biggerEMA < 1 || smallerEMA < 1) {
            alert('Please enter valid EMA lengths.');
            return;
        }
        if (biggerEMA <= smallerEMA) {
            alert('Bigger Length EMA must be greater than Smaller Length EMA.');
            return;
        }
        const url = `/api/candles?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&ema_short=${smallerEMA}&ema_long=${biggerEMA}`;
        const resp = await fetch(url);
        if (!resp.ok) {
            alert('Server error: ' + resp.status);
            return;
        }
        const data = await resp.json();
        if (data.candles && Array.isArray(data.candles) && data.candles.length > 0) {
            const chartData = data.candles.map(c => ({
                time: c.time,
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close
            }));
            // Always render candlesticks first
            candleSeries.setData(chartData);

            // Dual EMA overlay with crossover signals
            let biggerEMA = parseInt(document.getElementById('fast-ema').value, 10);
            let smallerEMA = parseInt(document.getElementById('slow-ema').value, 10);
            if (isNaN(biggerEMA) || isNaN(smallerEMA) || biggerEMA < 1 || smallerEMA < 1) {
                alert('Please enter valid EMA lengths.');
                return;
            }
            if (biggerEMA <= smallerEMA) {
                alert('Bigger Length EMA must be greater than Smaller Length EMA.');
                return;
            }
            let fastLength = biggerEMA;
            let slowLength = smallerEMA;
            if (isNaN(fastLength) || fastLength < 1 || isNaN(slowLength) || slowLength < 1) {
                alert('Please enter valid EMA lengths.');
                return;
            }
            if (Array.isArray(chartData) && chartData.length >= Math.max(fastLength, slowLength)) {
                const fastEMA = calculateEMA(chartData, fastLength);
                const slowEMA = calculateEMA(chartData, slowLength);
                if (!Array.isArray(fastEMA) || !Array.isArray(slowEMA) || fastEMA.length === 0 || slowEMA.length === 0) {
                    console.error('EMA calculation returned empty or invalid array');
                    return;
                }
                const fastSeries = chart.addLineSeries({ color: '#ff0000', lineWidth: 2 }); // Red
                const slowSeries = chart.addLineSeries({ color: '#28a745', lineWidth: 2 }); // Green
                fastSeries.setData(fastEMA);
                slowSeries.setData(slowEMA);

                // --- Use backend-provided buy/sell signals for markers ---
                if (data.signals && Array.isArray(data.signals) && data.signals.length > 0) {
                    const markers = data.signals.map(sig => ({
                        time: sig.time,
                        position: sig.signal === 'buy' ? 'belowBar' : 'aboveBar',
                        color: sig.signal === 'buy' ? 'green' : 'red',
                        shape: sig.signal === 'buy' ? 'arrowUp' : 'arrowDown',
                        size: 4
                    }));
                    candleSeries.setMarkers(markers);
                    console.log('Backend signals:', markers);
                } else {
                    candleSeries.setMarkers([]);
                }


                // --- Enhanced Trade log and portfolio calculation using backend signals ---
                let portfolio = [];
                if (data.signals && Array.isArray(data.signals) && data.signals.length > 0) {
                    let buys = data.signals.filter(s => s.signal === 'buy');
                    let sells = data.signals.filter(s => s.signal === 'sell');
                    let candlesByTime = {};
                    chartData.forEach(c => { candlesByTime[c.time] = c; });
                    let i = 0, j = 0;
                    while (i < buys.length && j < sells.length) {
                        // Find the next sell after the current buy
                        while (j < sells.length && sells[j].time <= buys[i].time) j++;
                        if (j < sells.length) {
                            let buy = buys[i];
                            let sell = sells[j];
                            let buyCandle = candlesByTime[buy.time];
                            let sellCandle = candlesByTime[sell.time];
                            let buyPrice = buyCandle ? buyCandle.close : buy.price;
                            let sellPrice = sellCandle ? sellCandle.close : sell.price;
                            let returns = sellPrice - buyPrice;
                            let pctReturns = ((returns / buyPrice) * 100).toFixed(2) + '%';
                            let profitOrLoss = returns > 0 ? 1 : -1;
                            portfolio.push({
                                buyDate: new Date(buy.time * 1000).toLocaleDateString(),
                                buyPrice: buyPrice?.toFixed(2),
                                sellDate: new Date(sell.time * 1000).toLocaleDateString(),
                                sellPrice: sellPrice?.toFixed(2),
                                returns: returns?.toFixed(2),
                                pctReturns,
                                profitOrLoss
                            });
                            i++;
                            j++;
                        } else {
                            break;
                        }
                    }
                }


                // --- Render enhanced portfolio table ---
                let tableHtml = `<table class='fancy-table' style='width:100%;border-collapse:collapse;margin-top:2em;'>`;
                tableHtml += `<style>
                #trade-log table.fancy-table {
                    background: linear-gradient(135deg, #f8fafc 60%, #e3e8ef 100%);
                    border-radius: 12px;
                    box-shadow: 0 2px 12px rgba(0,0,0,0.03);
                    animation: fadein 1.2s cubic-bezier(.39,.575,.565,1) both;
                }
                #trade-log table.fancy-table th, #trade-log table.fancy-table td {
                    text-align: right;
                    padding: 8px 10px;
                }
                #trade-log table.fancy-table thead tr {
                    background: #f2f6fa;
                }
                @keyframes fadein {
                  0% { opacity: 0; transform: translateY(30px); }
                  100% { opacity: 1; transform: none; }
                }
                </style>`;
                tableHtml += `<thead><tr style='background:#f2f2f2;'><th>Trade</th><th>Buy Date</th><th>Buy Price</th><th>Sell Date</th><th>Sell Price</th><th>Returns</th><th>% Returns</th><th>Profit/Loss</th></tr></thead><tbody>`;
                if (portfolio.length === 0) {
    tableHtml += `<tr><td colspan='8' style='text-align:center;color:#888;'>No trades found for these settings.</td></tr>`;
} else {
    portfolio.forEach((row, idx) => {
        tableHtml += `<tr><td>${idx+1}</td><td>${row.buyDate}</td><td>${row.buyPrice}</td><td>${row.sellDate}</td><td>${row.sellPrice}</td><td>${row.returns}</td><td>${row.pctReturns}</td><td style='color:${row.profitOrLoss===1?'green':'red'};'>${row.profitOrLoss===1?'Profit':'Loss'}</td></tr>`;
    });
}
tableHtml += `</tbody></table>`;

                // Summary stats
                let totalTrades = portfolio.length;
                let wins = portfolio.filter(r => r.profitOrLoss === 1).length;
                let losses = portfolio.filter(r => r.profitOrLoss === -1).length;
                let winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(2) : '0.00';
                let totalReturns = portfolio.reduce((acc, r) => acc + parseFloat(r.returns), 0).toFixed(2);
                let totalPctReturns = portfolio.reduce((acc, r) => acc + parseFloat(r.pctReturns.replace('%','')), 0).toFixed(2);

                tableHtml += `<div style='margin-top:1em;font-weight:bold;'>Total Trades: ${totalTrades} | Wins: ${wins} | Losses: ${losses} | Win Rate: ${winRate}% | Total Returns: ${totalReturns} (${totalPctReturns}%)</div>`;

                // --- Yearly Returns Table ---
                let yearlyStats = {};
                portfolio.forEach(row => {
                    let year = new Date(row.sellDate).getFullYear();
                    if (!yearlyStats[year]) yearlyStats[year] = { abs: 0, pct: 0, trades: 0 };
                    yearlyStats[year].abs += parseFloat(row.returns);
                    yearlyStats[year].pct += parseFloat(row.pctReturns.replace('%',''));
                    yearlyStats[year].trades += 1;
                });
                let years = Object.keys(yearlyStats).sort();
                let yearlyHtml = `<table class='yearly-fancy' style='width:60%;margin-top:1em;border-collapse:collapse;'><thead><tr style='background:#e7e7e7;'><th>Year</th><th>Trades</th><th>Total Returns</th><th>Total Returns (%)</th></tr></thead><tbody>`;
                yearlyHtml += `<style>
                #trade-log table.yearly-fancy {
                    background: linear-gradient(135deg, #f9fafb 60%, #e7ebf0 100%);
                    border-radius: 12px;
                    box-shadow: 0 2px 12px rgba(0,0,0,0.04);
                    animation: fadein 1.2s cubic-bezier(.39,.575,.565,1) both;
                }
                #trade-log table.yearly-fancy th, #trade-log table.yearly-fancy td {
                    text-align: right;
                    padding: 8px 12px;
                }
                #trade-log table.yearly-fancy thead tr {
                    background: #f2f6fa;
                }
                #trade-log table.yearly-fancy tr:last-child {
                    background: #f7f7f7;
                    font-weight: bold;
                }
                </style>`;
                let totalTradesY = 0, totalAbsY = 0, totalPctY = 0;
                years.forEach(year => {
                    yearlyHtml += `<tr><td>${year}</td><td>${yearlyStats[year].trades}</td><td>${yearlyStats[year].abs.toFixed(2)}</td><td>${yearlyStats[year].pct.toFixed(2)}%</td></tr>`;
                    totalTradesY += yearlyStats[year].trades;
                    totalAbsY += yearlyStats[year].abs;
                    totalPctY += yearlyStats[year].pct;
                });
                yearlyHtml += `<tr style='background:#f7f7f7;font-weight:bold;'><td>Total</td><td>${totalTradesY}</td><td>${totalAbsY.toFixed(2)}</td><td>${totalPctY.toFixed(2)}%</td></tr>`;
                yearlyHtml += `</tbody></table>`;

                document.getElementById('trade-log').innerHTML = tableHtml + yearlyHtml;
            
            } else {
                alert('Not enough data to calculate EMAs.');
            }

            // Session break logic: add vertical lines at the start of each new day
            addSessionBreaks(chart, chartData);

        } else {
            console.error('Chart data error:', data.error || 'No data found');
        }
    } catch (err) {
        console.error('Error loading data:', err);
        // Suppress all error popups, only log to console
        console.error('Error loading data:', err);
    }
}

// Helper function to add session breaks (vertical lines)

// Helper function to calculate RSI (Relative Strength Index)
function calculateRSI(data, period) {
    const rsi = [];
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = data[i].close - data[i-1].close;
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    let avgGain = gains / period, avgLoss = losses / period;
    for (let i = 0; i < data.length; i++) {
        if (i < period) {
            rsi.push({ time: data[i].time, value: null });
        } else {
            const diff = data[i].close - data[i-1].close;
            if (diff >= 0) {
                avgGain = (avgGain * (period-1) + diff) / period;
                avgLoss = (avgLoss * (period-1)) / period;
            } else {
                avgGain = (avgGain * (period-1)) / period;
                avgLoss = (avgLoss * (period-1) - diff) / period;
            }
            let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
            let rsiVal = 100 - (100 / (1 + rs));
            rsi.push({ time: data[i].time, value: rsiVal });
        }
    }
    return rsi.filter(e => e.value !== null);
}

// Helper function to calculate Supertrend (10,3)
function calculateSupertrend(data, period, multiplier) {
    // Calculate ATR
    let atr = [];
    for (let i = 0; i < data.length; i++) {
        if (i === 0) {
            atr.push(data[i].high - data[i].low);
        } else {
            const tr = Math.max(
                data[i].high - data[i].low,
                Math.abs(data[i].high - data[i-1].close),
                Math.abs(data[i].low - data[i-1].close)
            );
            atr.push(tr);
        }
    }
    // Smooth ATR
    for (let i = period; i < atr.length; i++) {
        atr[i] = (atr[i-1] * (period-1) + atr[i]) / period;
    }
    // Supertrend calculation
    let supertrend = [];
    let trend = 'down';
    let upperBand = 0, lowerBand = 0;
    for (let i = 0; i < data.length; i++) {
        if (i < period) {
            supertrend.push({ time: data[i].time, value: null, trend });
            continue;
        }
        const hl2 = (data[i].high + data[i].low) / 2;
        upperBand = hl2 + multiplier * atr[i];
        lowerBand = hl2 - multiplier * atr[i];
        if (i === period) {
            trend = data[i].close > upperBand ? 'up' : 'down';
        } else {
            if (data[i-1].close > upperBand) trend = 'up';
            else if (data[i-1].close < lowerBand) trend = 'down';
        }
        supertrend.push({ time: data[i].time, value: trend === 'up' ? lowerBand : upperBand, trend });
    }
    return supertrend.filter(e => e.value !== null);
}

// Helper function to calculate EMA
function calculateEMA(data, length) {
    const ema = [];
    let k = 2 / (length + 1);
    let prevEma = data[0].close;
    for (let i = 0; i < data.length; i++) {
        let price = data[i].close;
        if (i < length - 1) {
            ema.push({ time: data[i].time, value: null });
        } else if (i === length - 1) {
            // Simple average for first EMA value
            let sum = 0;
            for (let j = 0; j < length; j++) sum += data[i - j].close;
            prevEma = sum / length;
            ema.push({ time: data[i].time, value: prevEma });
        } else {
            prevEma = price * k + prevEma * (1 - k);
            ema.push({ time: data[i].time, value: prevEma });
        }
    }
    // Remove nulls for Lightweight Charts
    return ema.filter(e => e.value !== null);
}


// Load initial chart
document.addEventListener('DOMContentLoaded', loadChart);
window.loadChart = loadChart;

// --- Custom Date Range Stats ---
window.showCustomDateStats = function() {
    const fromDateStr = document.getElementById('from-date').value;
    const toDateStr = document.getElementById('to-date').value;
    if (!fromDateStr || !toDateStr) {
        document.getElementById('custom-date-stats').innerHTML = '<span style="color:red;">Please select both dates.</span>';
        return;
    }
    const fromDate = new Date(fromDateStr);
    const toDate = new Date(toDateStr);
    if (fromDate > toDate) {
        document.getElementById('custom-date-stats').innerHTML = '<span style="color:red;">From date must be before To date.</span>';
        return;
    }
    // Find the latest loaded portfolio table
    let tableRows = document.querySelectorAll('#trade-log table tbody tr');
    let filtered = [];
    tableRows.forEach(row => {
        let buyDate = row.children[1]?.textContent;
        let sellDate = row.children[3]?.textContent;
        if (!buyDate || !sellDate) return;
        let buy = new Date(buyDate);
        let sell = new Date(sellDate);
        if (buy >= fromDate && sell <= toDate) {
            filtered.push({
                buyDate,
                buyPrice: parseFloat(row.children[2]?.textContent),
                sellDate,
                sellPrice: parseFloat(row.children[4]?.textContent),
                returns: parseFloat(row.children[5]?.textContent),
                pctReturns: parseFloat(row.children[6]?.textContent.replace('%','')),
                profitOrLoss: row.children[7]?.textContent === 'Profit' ? 1 : -1,
            });
        }
    });
    let totalTrades = filtered.length;
    let wins = filtered.filter(r => r.profitOrLoss === 1).length;
    let losses = filtered.filter(r => r.profitOrLoss === -1).length;
    let winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(2) : '0.00';
    let totalReturns = filtered.reduce((acc, r) => acc + r.returns, 0).toFixed(2);
    let totalPctReturns = filtered.reduce((acc, r) => acc + r.pctReturns, 0).toFixed(2);
    document.getElementById('custom-date-stats').innerHTML =
        `<div style='font-weight:bold;font-size:1.1em;'>Custom Range: ${fromDateStr} to ${toDateStr}</div>`+
        `<div style='margin-top:0.5em;'>Total Trades: ${totalTrades} | Wins: ${wins} | Losses: ${losses} | Win Rate: ${winRate}% | Total Returns: ${totalReturns} (${totalPctReturns}%)</div>`;
}
