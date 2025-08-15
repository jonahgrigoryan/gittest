//+------------------------------------------------------------------+

//| FundingPips_Scalper.mq5|

//| EURUSD M15 scalper with FundingPips-style guards and tester reward

//| Paste into MetaEditor, compile (#property strict), attach to EURUSD M15

//+------------------------------------------------------------------+

#property copyright "you"

#property version "1.10"

#property strict

#include <Trade/Trade.mqh>

CTrade Trade;

//============================== Inputs ==============================

//--- Signals

input int EMA_Fast = 6; // [3..10]

input int EMA_Slow = 12; // [5..15]

input int RSI_Period = 14; // [10..20]

input int RSI_Hi = 75; // [70..80]

input int RSI_Lo = 25; // [20..30]

input int ADX_Period = 14; // [14..20]

input double ADX_Threshold = 22.0; // [20..30]

input int ATR_Period = 14; // [14..21]

input double ATR_SLx = 1.5; // [1.0..3.0]

input double ATR_TPx = 3.0; // [2.0..4.0]

input int Vol_Lookback = 20; // [10..40]

input double Vol_Mult = 2.0; // [1.5..3.0]

input bool Use_Engulfing = true;

input bool Use_VolumeSurge = true;

input bool Use_H4_D1_Bias = true;

//--- Risk/MM

input double RiskPctPerTrade = 0.50; // 0.25..0.75

input double TrailAfter_R = 1.00; // 0.8..1.2

input int MaxOpenTrades = 3; // 1..5

//--- Profit management

input bool Use_BreakEven = true;

input double BreakEven_R = 0.50; // move SL to BE at >= 0.5R

input bool Use_PartialClose = true;

input double PartialClose_R = 1.00; // take partial at >= 1R

input double PartialClose_Pct = 0.50; // close 50%

input bool UseTimeExit = true;

input int MaxHoldBars = 48; // close after N bars if not hit TP

input double BE_Buffer_Pips = 2.0; // buffer for breakeven in pips

//--- Anti-martingale sizing

input bool Use_AntiMartingale = true;

input int AntiMartingaleWinStreak = 2; // boost after N consecutive wins

input double AntiMartingaleMultiplier = 2.0; // multiply risk pct

input double MaxRiskPctCap = 1.00; // cap risk pct

//--- Extra filters

input bool UseVolatilityFilter = true;

input int ATRAvgLookback = 10; // average window for ATR

input double ATRVolatilityMult = 2.0; // current ATR > x * avg

input bool ExcludeFriday = true; // skip Fridays

//--- Market Regime Filter

input bool Use_MarketRegime = true;

input int ER_Period = 20; // bars

input double ER_Min = 0.35; // 0.30â€“0.40 typical

input int ADX_Slope_Period = 5; // bars

input double ADX_Slope_Min = 0.10; // Î”ADX over lookback

input bool RegimeRequireBoth = true; // true: ER AND slope; false: ER OR slope

//--- Pullback Entry Timing

input bool Use_PullbackEntry = true;

input double Pullback_MinPct = 0.38; // fib 38%

input double Pullback_MaxPct = 0.50; // fib 50%

input int Pullback_TimeoutBars = 5; // bars to fill

input bool UsePendingLimitOrders= true; // true=place limit; false=wait & hit at market

//--- Dynamic Exit Management

input bool Use_DynamicExit = true;

input bool ExitOnRSIMidband = true;

input int RSI_ExitMid = 50; // momentum mid-band

input bool ExitOnEMAReCross = true; // exit if EMA fast recrosses against position

input bool LetWinnersRun = true; // adjust trailing when regime is strong

input double TrailMultiplierStrongTrend = 1.25;

//--- Filters

input double MaxSpreadPips = 1.5; // 0.8..1.5

input bool RestrictTradingHours = false;

input int SessionStartHour = 0; // server time

input int SessionEndHour = 24;

//--- News (safe fallback implemented; calendar optional)

input bool UseEconomicCalendar = false; // if true, try MT5 calendar (requires broker support)

input int NewsSkip_Min = 10; // Â±minutes to skip around high impact events

// manual fallback: comma-separated unix timestamps (seconds) for upcoming high-impact EUR/USD events

input string ManualNewsEpochs = ""; // e.g. "1730973000,1731577800" (optional)

//--- Program Guards (FundingPips-style)

input double DailyStopProfitPct = 2.0; // halt for day if >= +2.0% from day start

input double DailyStopLossPct = -1.5; // halt for day if <= -1.5% from day start

input double EquityKillPct = 94.0; // halt if equity < 94% of initial equity

input int PauseOnConsecLosses= 3; // pause entries after N consecutive losses (reset daily)

input int MinTradingDaysReq = 5; // tester gate

input int MinTradesReq = 35; // tester gate

//--- Ops

input bool SendPushAlerts = false; // requires MetaQuotes ID in terminal

input bool DrawPanel = true;

//=========================== Globals / State =========================

string Sym = _Symbol;

ENUM_TIMEFRAMES TF = PERIOD_M15;

int hATR=-1, hRSI=-1, hADX=-1, hEMAfast=-1, hEMAslow=-1;

int hEMAfast_H4=-1, hEMAslow_H4=-1, hEMAfast_D1=-1, hEMAslow_D1=-1;

datetime g_day_anchor = 0;

double g_init_equity = 0.0;

double g_daily_start_equity = 0.0;

double g_daily_peak_equity = 0.0;

double g_daily_trough_equity= 0.0;

bool g_daily_halted = false;

double g_equity_highest = -DBL_MAX;

double g_equity_lowest = DBL_MAX;

double g_max_total_drawdown_pct = 0.0;

double g_max_daily_drawdown_pct = 0.0;

int g_consec_losses = 0;

int g_trades_total = 0; // closed trades (counted on close deal)

int g_trades_wins = 0; // closed trades with profit > 0

bool g_today_has_trade = false; // for trading-days count

int g_today_trades_count = 0;

int g_trading_days_with_trades = 0;

int g_consec_wins = 0;

// daily equity series for Sharpe in tester

struct DayRec { datetime day; double start_eq; double end_eq; double pnl; int trades; };

DayRec g_days[1024];

int g_days_count = 0;

// track per-position state for partial closes / initial risk / BE

#define MAX_TRACK 256

struct PosTrack { ulong ticket; double init_vol; double init_sl; double init_risk; datetime open_time; bool partial_done; bool be_done; };

PosTrack g_pos_track[MAX_TRACK];

int g_pos_track_count = 0;

int FindTrackIndex(ulong ticket)

{

for(int i=0;i<g_pos_track_count;i++) if(g_pos_track[i].ticket==ticket) return i;

return -1;

}

int EnsureTrackForCurrentPosition()

{

ulong ticket = (ulong)PositionGetInteger(POSITION_TICKET);

int idx = FindTrackIndex(ticket);

if(idx>=0) return idx;

if(g_pos_track_count>=MAX_TRACK) return -1;

int ni = g_pos_track_count++;

g_pos_track[ni].ticket = ticket;

g_pos_track[ni].init_vol = PositionGetDouble(POSITION_VOLUME);

g_pos_track[ni].init_sl = PositionGetDouble(POSITION_SL);

double open = PositionGetDouble(POSITION_PRICE_OPEN);

double init_risk = MathAbs(open - g_pos_track[ni].init_sl);

if(init_risk<=0) init_risk = MathAbs(open - PositionGetDouble(POSITION_SL));

g_pos_track[ni].init_risk = init_risk;

g_pos_track[ni].open_time = (datetime)PositionGetInteger(POSITION_TIME);

g_pos_track[ni].partial_done = false;

g_pos_track[ni].be_done = false;

return ni;

}

// dynamic exit flags in tracking

struct PendingSetup { bool active; bool isLong; double anchor_high; double anchor_low; double entry_price; double sl_price; double tp_price; datetime expire_time; ulong order_ticket; };

PendingSetup g_pending = {false};

// panel id

#define PANEL_ID "FP_PANEL"

//============================= Utilities =============================

int Dig() { return (int)SymbolInfoInteger(Sym, SYMBOL_DIGITS); }

double Pip() { return (SymbolInfoInteger(Sym, SYMBOL_DIGITS)==5 || SymbolInfoInteger(Sym, SYMBOL_DIGITS)==3) ? 10.0*_Point : _Point; }

double SpreadPips()

{

long spr_points=0;

if(!SymbolInfoInteger(Sym, SYMBOL_SPREAD, spr_points)) return 999.0;

return (spr_points * _Point) / Pip();

}

datetime DateOf(datetime t)

{

MqlDateTime d; TimeToStruct(t, d);

d.hour=0; d.min=0; d.sec=0;

return StructToTime(d);

}

double PriceNormalize(double price){ return NormalizeDouble(price, Dig()); }

bool SessionOK(datetime now)

{

MqlDateTime t; TimeToStruct(now, t);

// Always enforce Friday exclusion regardless of hour restriction

if(ExcludeFriday && t.day_of_week==5) return false;

if(!RestrictTradingHours) return true;

if(SessionStartHour<=SessionEndHour)

return (t.hour>=SessionStartHour && t.hour<SessionEndHour);

return (t.hour>=SessionStartHour || t.hour<SessionEndHour);

}

//========================= Indicator helpers =========================

bool EnsureHandles()

{

if(hATR<=0) hATR = iATR(Sym, TF, ATR_Period);

if(hRSI<=0) hRSI = iRSI(Sym, TF, RSI_Period, PRICE_CLOSE);

if(hADX<=0) hADX = iADX(Sym, TF, ADX_Period);

if(hEMAfast<=0) hEMAfast = iMA(Sym, TF, EMA_Fast, 0, MODE_EMA, PRICE_CLOSE);

if(hEMAslow<=0) hEMAslow = iMA(Sym, TF, EMA_Slow, 0, MODE_EMA, PRICE_CLOSE);

if(Use_H4_D1_Bias)

{

if(hEMAfast_H4<=0) hEMAfast_H4 = iMA(Sym, PERIOD_H4, EMA_Fast, 0, MODE_EMA, PRICE_CLOSE);

if(hEMAslow_H4<=0) hEMAslow_H4 = iMA(Sym, PERIOD_H4, EMA_Slow, 0, MODE_EMA, PRICE_CLOSE);

if(hEMAfast_D1<=0) hEMAfast_D1 = iMA(Sym, PERIOD_D1, EMA_Fast, 0, MODE_EMA, PRICE_CLOSE);

if(hEMAslow_D1<=0) hEMAslow_D1 = iMA(Sym, PERIOD_D1, EMA_Slow, 0, MODE_EMA, PRICE_CLOSE);

}

return (hATR>0 && hRSI>0 && hADX>0 && hEMAfast>0 && hEMAslow>0);

}

bool Copy1(int handle, double &val, int shift=0)

{

double buf[];

if(CopyBuffer(handle, 0, shift, 1, buf)!=1) return false;

val=buf[0]; return true;

}

//=========================== Utilities (new) ===========================

double EfficiencyRatio(int period, int shift=1)

{

if(period<=1) return 0.0;

MqlRates rates[];

if(CopyRates(Sym, TF, shift, period, rates)!=period) return 0.0;

double close_start = rates[period-1].close;

double close_end = rates[0].close;

double num = MathAbs(close_end - close_start);

double den = 0.0;

for(int i=0;i<period-1;i++) den += MathAbs(rates[i].close - rates[i+1].close);

if(den<=0.0) return 0.0;

double er = num/den;

if(er<0.0) er=0.0; if(er>1.0) er=1.0;

return er;

}

double ADXSlope(int lookback=0, int shift=1)

{

if(lookback<=0) lookback = ADX_Slope_Period;

double buf[]; int need = lookback+1;

if(CopyBuffer(hADX, 0, shift, need, buf)!=need) return 0.0;

return buf[0] - buf[lookback];

}

bool IsTrending(double &er_out, double &adx_slope_out)

{

if(!Use_MarketRegime) { er_out=0.0; adx_slope_out=0.0; return true; }

er_out = EfficiencyRatio(ER_Period, 1);

adx_slope_out = ADXSlope(ADX_Slope_Period, 1);

if(RegimeRequireBoth) return (er_out>=ER_Min && adx_slope_out>=ADX_Slope_Min);

return (er_out>=ER_Min || adx_slope_out>=ADX_Slope_Min);

}

bool FindPullbackLevels(bool forLong, double &entry_price, double &sl_price, double &tp_price, double &anc_low, double &anc_high)

{

int swing = MathMax(ER_Period, 20);

int idx_low = iLowest(Sym, TF, MODE_LOW, swing, 1);

int idx_high= iHighest(Sym, TF, MODE_HIGH, swing, 1);

if(idx_low<=0 || idx_high<=0) return false;

MqlRates r0[];

if(CopyRates(Sym, TF, 1, swing+1, r0)<swing+1) return false;

anc_low = r0[idx_low-1].low; // because r0[0] is shift=1

anc_high = r0[idx_high-1].high;

double range = anc_high - anc_low;

if(range<=0) return false;

if(forLong)

{

double pb_min = anc_high - Pullback_MaxPct*range;

double pb_max = anc_high - Pullback_MinPct*range;

entry_price = PriceNormalize((pb_min + pb_max)/2.0);

}

else

{

double pb_min = anc_low + Pullback_MinPct*range;

double pb_max = anc_low + Pullback_MaxPct*range;

entry_price = PriceNormalize((pb_min + pb_max)/2.0);

}

double atr_pts = GetATRPoints(); if(atr_pts<=0) return false;

sl_price = ComputeSL(entry_price, forLong, atr_pts);

tp_price = ComputeTP(entry_price, sl_price, forLong);

return true;

}

double ComputeLotsForEntry(double risk_pct, double entry_price, double sl_price, bool isLong)

{

double equity = AccountInfoDouble(ACCOUNT_EQUITY);

double adj_risk_pct = risk_pct;

if(Use_AntiMartingale && g_consec_wins >= AntiMartingaleWinStreak)

adj_risk_pct = MathMin(MaxRiskPctCap, risk_pct * AntiMartingaleMultiplier);

double risk_money = equity*(adj_risk_pct/100.0);

double sl_pts = MathAbs(entry_price - sl_price)/_Point;

double tick_val = SymbolInfoDouble(Sym, SYMBOL_TRADE_TICK_VALUE);

double tick_size = SymbolInfoDouble(Sym, SYMBOL_TRADE_TICK_SIZE);

if(tick_val<=0 || tick_size<=0 || sl_pts<=0) return 0.0;

double per_point = tick_val * (_Point/tick_size);

double lots = risk_money / (sl_pts * per_point);

double minlot=SymbolInfoDouble(Sym,SYMBOL_VOLUME_MIN);

double maxlot=SymbolInfoDouble(Sym,SYMBOL_VOLUME_MAX);

double step =SymbolInfoDouble(Sym,SYMBOL_VOLUME_STEP);

lots = MathMax(minlot, MathMin(maxlot, lots));

lots = MathFloor(lots/step)*step;

return lots;

}

int OrdersTotalBySymbol(string sym)

{

int cnt=0;

for(int i=0;i<OrdersTotal();i++)

{

if(!OrderSelect(i, SELECT_BY_POS)) continue;

if(OrderGetString(ORDER_SYMBOL)!=sym) continue;

ENUM_ORDER_TYPE t = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);

if(

t==ORDER_TYPE_BUY_LIMIT ||

t==ORDER_TYPE_SELL_LIMIT ||

t==ORDER_TYPE_BUY_STOP ||

t==ORDER_TYPE_SELL_STOP ||

t==ORDER_TYPE_BUY_STOP_LIMIT ||

t==ORDER_TYPE_SELL_STOP_LIMIT

)

cnt++;

}

return cnt;

}

//======================= Patterns & filters ==========================

bool IsBullishEngulfing(int shift=1)

{

MqlRates r[3]; if(CopyRates(Sym, TF, shift, 3, r)!=3) return false;

bool prevBear = (r[2].close < r[2].open);

bool currBull = (r[1].close > r[1].open);

double prevBody = MathAbs(r[2].close - r[2].open);

double currBody = MathAbs(r[1].close - r[1].open);

bool engulfs = (r[1].open < r[2].close && r[1].close > r[2].open);

return prevBear && currBull && currBody>prevBody && engulfs;

}

bool IsBearishEngulfing(int shift=1)

{

MqlRates r[3]; if(CopyRates(Sym, TF, shift, 3, r)!=3) return false;

bool prevBull = (r[2].close > r[2].open);

bool currBear = (r[1].close < r[1].open);

double prevBody = MathAbs(r[2].close - r[2].open);

double currBody = MathAbs(r[1].close - r[1].open);

bool engulfs = (r[1].open > r[2].close && r[1].close < r[2].open);

return prevBull && currBear && currBody>prevBody && engulfs;

}

bool HasVolumeSurge(int lookback, double mult, int shift=0)

{

long vol[];

if(CopyTickVolume(Sym, TF, shift, lookback+1, vol)!=lookback+1) return false;

double sma=0.0;

for(int i=1;i<=lookback;i++) sma += (double)vol[i];

sma /= (double)lookback;

return ((double)vol[0] >= mult*sma);

}

//========================== News window =================================

// NOTE: Economic Calendar APIs vary by broker; safe fallback below always compiles.

bool InManualNewsWindow(datetime now)

{

if(StringLen(ManualNewsEpochs)==0 || NewsSkip_Min<=0) return false;

string parts[];

int n = StringSplit(ManualNewsEpochs, ',', parts);

for(int i=0;i<n;i++)

{

string token = StringTrimLeft(StringTrimRight(parts[i]));

datetime t = (datetime)StringToInteger(token);

if(MathAbs((long)(now - t)) <= (long)(NewsSkip_Min*60)) return true;

}

return false;

}

bool InCalendarNewsWindow(datetime now)

{

// Placeholder â€œtrue implementation hookâ€:

// If your broker supports the Economic Calendar, replace this functionâ€™s body with:

// - Query events around `now` for currencies EUR or USD, importance HIGH

// - Return true if event within Â±NewsSkip_Min minutes.

// To keep this EA portable/compilable, we return false here.

return false;

}

bool InNewsWindow(datetime now)

{

if(NewsSkip_Min<=0) return false;

if(UseEconomicCalendar)

return InCalendarNewsWindow(now);

return InManualNewsWindow(now);

}

//========================== Signals ====================================

bool BiasOKLong()

{

if(!Use_H4_D1_Bias) return true;

double f4,s4,fD,sD;

if(!Copy1(hEMAfast_H4,f4) || !Copy1(hEMAslow_H4,s4) || !Copy1(hEMAfast_D1,fD) || !Copy1(hEMAslow_D1,sD)) return false;

return (f4>s4 && fD>sD);

}

bool BiasOKShort()

{

if(!Use_H4_D1_Bias) return true;

double f4,s4,fD,sD;

if(!Copy1(hEMAfast_H4,f4) || !Copy1(hEMAslow_H4,s4) || !Copy1(hEMAfast_D1,fD) || !Copy1(hEMAslow_D1,sD)) return false;

return (f4<s4 && fD<sD);

}

bool LongSignal()

{

double emaF,emaS,rsi,adx;

if(!Copy1(hEMAfast,emaF) || !Copy1(hEMAslow,emaS) || !Copy1(hRSI,rsi) || !Copy1(hADX,adx)) return false;

bool crossUp = (emaF>emaS);

bool rsiOK = (rsi<RSI_Hi);

bool adxOK = (adx>=ADX_Threshold);

bool patOK = (!Use_Engulfing || IsBullishEngulfing(1));

bool volOK = (!Use_VolumeSurge || HasVolumeSurge(Vol_Lookback, Vol_Mult, 0));

return crossUp && rsiOK && adxOK && patOK && volOK && BiasOKLong();

}

bool ShortSignal()

{

double emaF,emaS,rsi,adx;

if(!Copy1(hEMAfast,emaF) || !Copy1(hEMAslow,emaS) || !Copy1(hRSI,rsi) || !Copy1(hADX,adx)) return false;

bool crossDn = (emaF<emaS);

bool rsiOK = (rsi>RSI_Lo);

bool adxOK = (adx>=ADX_Threshold);

bool patOK = (!Use_Engulfing || IsBearishEngulfing(1));

bool volOK = (!Use_VolumeSurge || HasVolumeSurge(Vol_Lookback, Vol_Mult, 0));

return crossDn && rsiOK && adxOK && patOK && volOK && BiasOKShort();

}

//====================== Risk / sizing / orders ========================

double GetATRPoints(){ double v; if(!Copy1(hATR,v,1)) return 0.0; return v/_Point; }

double ComputeSL(double entry_price, bool isLong, double atr_points)

{

double dist_pts = ATR_SLx * atr_points;

return isLong ? PriceNormalize(entry_price - dist_pts*_Point)

: PriceNormalize(entry_price + dist_pts*_Point);

}

double ComputeTP(double entry_price, double sl_price, bool isLong)

{

double risk_pts = MathAbs(entry_price - sl_price)/_Point;

double tp_pts = (ATR_TPx/ATR_SLx)*risk_pts;

return isLong ? PriceNormalize(entry_price + tp_pts*_Point)

: PriceNormalize(entry_price - tp_pts*_Point);

}

double ComputeLots(double risk_pct, double sl_price, bool isLong)

{

double equity = AccountInfoDouble(ACCOUNT_EQUITY);

// anti-martingale adjustment based on recent win streak

double adj_risk_pct = risk_pct;

if(Use_AntiMartingale && g_consec_wins >= AntiMartingaleWinStreak)

{

adj_risk_pct = MathMin(MaxRiskPctCap, risk_pct * AntiMartingaleMultiplier);

}

double risk_money = equity*(adj_risk_pct/100.0);

double entry = isLong ? SymbolInfoDouble(Sym,SYMBOL_ASK) : SymbolInfoDouble(Sym,SYMBOL_BID);

double sl_pts = MathAbs(entry - sl_price)/_Point;

double tick_val = SymbolInfoDouble(Sym, SYMBOL_TRADE_TICK_VALUE);

double tick_size = SymbolInfoDouble(Sym, SYMBOL_TRADE_TICK_SIZE);

if(tick_val<=0 || tick_size<=0 || sl_pts<=0) return 0.0;

double per_point = tick_val * (_Point/tick_size);

double lots = risk_money / (sl_pts * per_point);

double minlot=SymbolInfoDouble(Sym,SYMBOL_VOLUME_MIN);

double maxlot=SymbolInfoDouble(Sym,SYMBOL_VOLUME_MAX);

double step =SymbolInfoDouble(Sym,SYMBOL_VOLUME_STEP);

lots = MathMax(minlot, MathMin(maxlot, lots));

lots = MathFloor(lots/step)*step;

return lots;

}

int PositionsTotalBySymbol(string sym)

{

int cnt=0;

for(int i=0;i<PositionsTotal();i++)

{

ulong ticket = PositionGetTicket(i);

if(ticket==0) continue;

if(!PositionSelectByTicket(ticket)) continue;

if(PositionGetString(POSITION_SYMBOL)==sym) cnt++;

}

return cnt;

}

//======================= Guards / accounting ==========================

void StartNewDay(datetime now)

{

// finalize previous day record

if(g_day_anchor!=0)

{

DayRec d; d.day = g_day_anchor;

d.start_eq = g_daily_start_equity;

d.end_eq = AccountInfoDouble(ACCOUNT_EQUITY);

d.pnl = d.end_eq - d.start_eq;

d.trades = g_today_trades_count;

if(g_days_count<1024) g_days[g_days_count++] = d;

if(g_today_has_trade) g_trading_days_with_trades++;

}

// reset for new day

g_day_anchor = DateOf(now);

g_daily_start_equity = AccountInfoDouble(ACCOUNT_EQUITY);

g_daily_peak_equity = g_daily_start_equity;

g_daily_trough_equity= g_daily_start_equity;

g_today_has_trade = false;

g_today_trades_count = 0;

g_daily_halted = false;

g_consec_losses = 0;

g_consec_wins = 0;

}

void MaybeRolloverDay(datetime now)

{

if(g_day_anchor==0) { StartNewDay(now); return; }

if(DateOf(now)!=g_day_anchor) StartNewDay(now);

}

void UpdateDrawdowns()

{

double eq = AccountInfoDouble(ACCOUNT_EQUITY);

g_equity_highest = (g_equity_highest==-DBL_MAX ? eq : MathMax(g_equity_highest, eq));

g_equity_lowest = (g_equity_lowest== DBL_MAX ? eq : MathMin(g_equity_lowest, eq));

g_daily_peak_equity = MathMax(g_daily_peak_equity, eq);

g_daily_trough_equity = MathMin(g_daily_trough_equity, eq);

if(g_equity_highest>0)

{

double dd_total = 100.0*(g_equity_highest - eq)/g_equity_highest;

g_max_total_drawdown_pct = MathMax(g_max_total_drawdown_pct, dd_total);

}

if(g_daily_peak_equity>0)

{

double dd_day = 100.0*(g_daily_peak_equity - eq)/g_daily_peak_equity;

g_max_daily_drawdown_pct = MathMax(g_max_daily_drawdown_pct, dd_day);

}

}

bool FundingPipsHaltNow()

{

double eq = AccountInfoDouble(ACCOUNT_EQUITY);

double day_delta_pct = 100.0*(eq - g_daily_start_equity)/g_daily_start_equity;

if(day_delta_pct >= DailyStopProfitPct) return true;

if(day_delta_pct <= DailyStopLossPct) return true;

if(100.0 * eq / g_init_equity <= EquityKillPct) return true;

return false;

}

bool CanOpenNewTrade(datetime now)

{

if(g_daily_halted) return false;

if(FundingPipsHaltNow()) { g_daily_halted=true; return false; }

if(SpreadPips()>MaxSpreadPips) return false;

if(!SessionOK(now)) return false;

if(InNewsWindow(now)) return false;

if(UseVolatilityFilter)

{

double curATR; if(!Copy1(hATR,curATR,1)) return false; // use completed bar

double sum=0.0; double buf[64];

int need = MathMin(ATRAvgLookback, 60);

int got = CopyBuffer(hATR, 0, 2, need, buf); // prior completed bars excluding bar #1

if(got<=0) return false;

for(int i=0;i<got;i++) sum+=buf[i];

double avg = sum/got;

if(avg<=0) return true;

if(curATR > ATRVolatilityMult*avg) return false;

}

if(g_consec_losses>=PauseOnConsecLosses) return false;

// Market regime filter

if(Use_MarketRegime)

{

double er,slope; if(!IsTrending(er,slope)) return false;

}

// capacity guard considers pending orders as well

if(PositionsTotalBySymbol(Sym) + OrdersTotalBySymbol(Sym) >= MaxOpenTrades) return false;

return true;

}

//================== Execution & management ===========================

void TryEntries()

{

datetime now = TimeCurrent();

if(!CanOpenNewTrade(now)) return;

double atr_pts = GetATRPoints();

if(atr_pts<=0) return;

// avoid double-arming a pending setup

if(Use_PullbackEntry && g_pending.active) return;

// Long

if(LongSignal())

{

if(Use_PullbackEntry)

{

double ep,sl,tp,ancL,ancH;

if(FindPullbackLevels(true, ep, sl, tp, ancL, ancH))

{

g_pending.active=true; g_pending.isLong=true; g_pending.anchor_high=ancH; g_pending.anchor_low=ancL;

g_pending.entry_price=ep; g_pending.sl_price=sl; g_pending.tp_price=tp;

g_pending.expire_time = now + Pullback_TimeoutBars*PeriodSeconds(TF);

g_pending.order_ticket = 0;

if(UsePendingLimitOrders)

{

double bid = SymbolInfoDouble(Sym,SYMBOL_BID);

if(ep <= bid)

{

double lots = ComputeLotsForEntry(RiskPctPerTrade, ep, sl, true);

if(lots>0)

{

int stops = (int)SymbolInfoInteger(Sym, SYMBOL_TRADE_STOPS_LEVEL);

if(MathAbs(bid - ep) >= stops*_Point)

{

double minDist = stops*_Point;

bool sl_ok = (MathAbs(ep - sl) >= minDist);

bool tp_ok = (MathAbs(tp - ep) >= minDist);

if(!sl_ok || !tp_ok)

{

Print("BuyLimit skipped: SL/TP too close to entry");

}

else

{

MqlTradeRequest req; MqlTradeResult res; ZeroMemory(req); ZeroMemory(res);

req.action=TRADE_ACTION_PENDING; req.symbol=Sym; req.type=ORDER_TYPE_BUY_LIMIT; req.volume=lots; req.price=ep; req.sl=sl; req.tp=tp;

req.type_time = ORDER_TIME_SPECIFIED; req.expiration = g_pending.expire_time;

const int OK_PLACED=10008, OK_DONE=10009;

if(!OrderSend(req,res) || (res.retcode!=OK_PLACED && res.retcode!=OK_DONE) || res.order==0) Print("BuyLimit failed ",res.retcode,": ",res.comment);

else g_pending.order_ticket = res.order;

}

}

}

}

}

}

}

else

{

double ask = SymbolInfoDouble(Sym,SYMBOL_ASK);

double sl = ComputeSL(ask, true, atr_pts);

double tp = ComputeTP(ask, sl, true);

double lots= ComputeLots(RiskPctPerTrade, sl, true);

if(lots>0 && Trade.Buy(lots, Sym, ask, sl, tp))

{

if(SendPushAlerts) SendNotification("BUY "+Sym+" "+DoubleToString(lots,2)+" SL="+DoubleToString(sl,Dig())+" TP="+DoubleToString(tp,Dig()));

}

}

}

// Short

else if(ShortSignal())

{

if(Use_PullbackEntry)

{

double ep,sl,tp,ancL,ancH;

if(FindPullbackLevels(false, ep, sl, tp, ancL, ancH))

{

g_pending.active=true; g_pending.isLong=false; g_pending.anchor_high=ancH; g_pending.anchor_low=ancL;

g_pending.entry_price=ep; g_pending.sl_price=sl; g_pending.tp_price=tp;

g_pending.expire_time = now + Pullback_TimeoutBars*PeriodSeconds(TF);

g_pending.order_ticket = 0;

if(UsePendingLimitOrders)

{

double ask = SymbolInfoDouble(Sym,SYMBOL_ASK);

if(ep >= ask)

{

double lots = ComputeLotsForEntry(RiskPctPerTrade, ep, sl, false);

if(lots>0)

{

int stops = (int)SymbolInfoInteger(Sym, SYMBOL_TRADE_STOPS_LEVEL);

if(MathAbs(ask - ep) >= stops*_Point)

{

double minDist = stops*_Point;

bool sl_ok = (MathAbs(ep - sl) >= minDist);

bool tp_ok = (MathAbs(tp - ep) >= minDist);

if(!sl_ok || !tp_ok)

{

Print("SellLimit skipped: SL/TP too close to entry");

}

else

{

MqlTradeRequest req; MqlTradeResult res; ZeroMemory(req); ZeroMemory(res);

req.action=TRADE_ACTION_PENDING; req.symbol=Sym; req.type=ORDER_TYPE_SELL_LIMIT; req.volume=lots; req.price=ep; req.sl=sl; req.tp=tp;

req.type_time = ORDER_TIME_SPECIFIED; req.expiration = g_pending.expire_time;

const int OK_PLACED=10008, OK_DONE=10009;

if(!OrderSend(req,res) || (res.retcode!=OK_PLACED && res.retcode!=OK_DONE) || res.order==0) Print("SellLimit failed ",res.retcode,": ",res.comment);

else g_pending.order_ticket = res.order;

}

}

}

}

}

}

}

else

{

double bid = SymbolInfoDouble(Sym,SYMBOL_BID);

double sl = ComputeSL(bid, false, atr_pts);

double tp = ComputeTP(bid, sl, false);

double lots= ComputeLots(RiskPctPerTrade, sl, false);

if(lots>0 && Trade.Sell(lots, Sym, bid, sl, tp))

{

if(SendPushAlerts) SendNotification("SELL "+Sym+" "+DoubleToString(lots,2)+" SL="+DoubleToString(sl,Dig())+" TP="+DoubleToString(tp,Dig()));

}

}

}

}

void ManageOpenPositions()

{

for(int i=PositionsTotal()-1;i>=0;i--)

{

ulong ticket = PositionGetTicket(i);

if(ticket==0) continue;

if(PositionGetString(POSITION_SYMBOL)!=Sym) continue;

long type = PositionGetInteger(POSITION_TYPE);

double open = PositionGetDouble(POSITION_PRICE_OPEN);

double sl = PositionGetDouble(POSITION_SL);

double tp = PositionGetDouble(POSITION_TP);

double cur = (type==POSITION_TYPE_BUY ? SymbolInfoDouble(Sym,SYMBOL_BID) : SymbolInfoDouble(Sym,SYMBOL_ASK));

double risk = MathAbs(open - sl);

if(risk<=0) continue;

double gain = (type==POSITION_TYPE_BUY ? cur - open : open - cur);

double R = gain / risk;

// ensure tracking record exists

int ti = EnsureTrackForCurrentPosition();

bool have_track = (ti >= 0);

if(have_track)

{

// time-based exit

if(UseTimeExit && MaxHoldBars>0)

{

int bars_now = iBarShift(Sym, TF, TimeCurrent(), false);

int bars_open = iBarShift(Sym, TF, g_pos_track[ti].open_time, false);

if(bars_now>=0 && bars_open>=0)

{

int bars_held = MathMax(0, bars_open - bars_now);

if(bars_held >= MaxHoldBars)

{

if(!Trade.PositionClose(ticket) || Trade.ResultRetcode()!=10009)

Print("Time exit close failed: ", Trade.ResultRetcode(), " ", Trade.ResultRetcodeDescription());

continue;

}

}

}

// dynamic exit tightening before BE/partial/trailing

if(Use_DynamicExit)

{

// pull closed-bar values

double rsi1; if(!Copy1(hRSI, rsi1, 1)) rsi1=50.0;

double emaF1, emaS1; bool emok = (Copy1(hEMAfast, emaF1, 1) && Copy1(hEMAslow, emaS1, 1));

bool exit_cond=false;

if(type==POSITION_TYPE_BUY)

{

if(ExitOnRSIMidband && rsi1 < RSI_ExitMid) exit_cond=true;

if(ExitOnEMAReCross && emok && emaF1 < emaS1) exit_cond=true;

}

else

{

if(ExitOnRSIMidband && rsi1 > RSI_ExitMid) exit_cond=true;

if(ExitOnEMAReCross && emok && emaF1 > emaS1) exit_cond=true;

}

if(exit_cond)

{

// tighten SL instead of flat to avoid whipsaw, obey StopsLevel

double tightSL;

if(type==POSITION_TYPE_BUY) tightSL = MathMax(sl, open); else tightSL = MathMin(sl, open);

tightSL = PriceNormalize(tightSL);

int stops = (int)SymbolInfoInteger(Sym, SYMBOL_TRADE_STOPS_LEVEL);

double minDist = stops * _Point;

double ref = (type==POSITION_TYPE_BUY)? SymbolInfoDouble(Sym,SYMBOL_BID):SymbolInfoDouble(Sym,SYMBOL_ASK);

bool dist_ok = (type==POSITION_TYPE_BUY) ? ((ref - tightSL) >= minDist) : ((tightSL - ref) >= minDist);

if(dist_ok && MathAbs(tightSL - sl) > _Point)

{

if(Trade.PositionModify(ticket, tightSL, tp) && Trade.ResultRetcode()==10009)

{

sl = tightSL;

risk = MathAbs(open - sl);

}

else

Print("DynExit modify failed: ", Trade.ResultRetcode(), " ", Trade.ResultRetcodeDescription());

}

}

}

// break-even move with buffer and StopsLevel guard

if(Use_BreakEven && !g_pos_track[ti].be_done && g_pos_track[ti].init_risk>0)

{

if(R >= BreakEven_R)

{

double buf_px = (BE_Buffer_Pips>0.0 ? BE_Buffer_Pips*Pip()

: (double)SymbolInfoInteger(Sym, SYMBOL_SPREAD)*_Point);

double be_sl = (type==POSITION_TYPE_BUY) ? (open + buf_px)

: (open - buf_px);

be_sl = PriceNormalize(be_sl);

int stops = (int)SymbolInfoInteger(Sym, SYMBOL_TRADE_STOPS_LEVEL);

double minDist = stops * _Point;

double refPrice = (type==POSITION_TYPE_BUY) ? SymbolInfoDouble(Sym,SYMBOL_BID)

: SymbolInfoDouble(Sym,SYMBOL_ASK);

bool dist_ok = (type==POSITION_TYPE_BUY) ? ((refPrice - be_sl) >= minDist)

: ((be_sl - refPrice) >= minDist);

bool protective = (type==POSITION_TYPE_BUY) ? (be_sl >= sl) : (be_sl <= sl);

if(dist_ok && protective && MathAbs(be_sl - sl) > _Point)

{

if(Trade.PositionModify(ticket, be_sl, tp) && Trade.ResultRetcode()==10009)

{

g_pos_track[ti].be_done = true;

// keep locals in sync for later logic

sl = be_sl;

risk = MathAbs(open - sl);

}

else

Print("BE modify failed: ", Trade.ResultRetcode(), " ", Trade.ResultRetcodeDescription());

}

}

}

// partial close at 1R

if(Use_PartialClose && !g_pos_track[ti].partial_done && g_pos_track[ti].init_risk>0)

{

if(R >= PartialClose_R)

{

double vol = PositionGetDouble(POSITION_VOLUME);

double close_vol = MathMax(SymbolInfoDouble(Sym, SYMBOL_VOLUME_MIN), vol * PartialClose_Pct);

close_vol = MathMin(close_vol, vol - SymbolInfoDouble(Sym, SYMBOL_VOLUME_MIN));

double step = SymbolInfoDouble(Sym, SYMBOL_VOLUME_STEP);

if(step>0) close_vol = MathFloor(close_vol/step)*step;

if(close_vol > 0)

{

if(!Trade.PositionClosePartial(ticket, close_vol) || Trade.ResultRetcode()!=10009)

Print("Partial close failed: ", Trade.ResultRetcode(), " ", Trade.ResultRetcodeDescription());

else

g_pos_track[ti].partial_done = true;

}

}

}

}

// trailing stop after configured R; use initial risk to gate trailing

double R_init = (have_track && g_pos_track[ti].init_risk>0) ? (gain / g_pos_track[ti].init_risk) : R;

// strong-trend trail scaling

double trail_mult = 1.0;

if(LetWinnersRun && Use_MarketRegime)

{

double er_now = EfficiencyRatio(ER_Period,1);

double slope_now = ADXSlope(ADX_Slope_Period,1);

if(er_now >= ER_Min+0.10 && slope_now >= ADX_Slope_Min*1.5) trail_mult = TrailMultiplierStrongTrend;

}

if(R_init >= TrailAfter_R)

{

double newSL;

if(type==POSITION_TYPE_BUY) newSL = MathMax(open, cur - risk*trail_mult);

else newSL = MathMin(open, cur + risk*trail_mult);

newSL = PriceNormalize(newSL);

if(MathAbs(newSL - sl) > _Point)

{

bool protective = (type==POSITION_TYPE_BUY) ? (newSL >= sl) : (newSL <= sl);

int stops = (int)SymbolInfoInteger(Sym, SYMBOL_TRADE_STOPS_LEVEL);

double minDist = stops * _Point;

double refPrice = (type==POSITION_TYPE_BUY) ? SymbolInfoDouble(Sym,SYMBOL_BID) : SymbolInfoDouble(Sym,SYMBOL_ASK);

bool dist_ok = (type==POSITION_TYPE_BUY) ? ((refPrice - newSL) >= minDist) : ((newSL - refPrice) >= minDist);

if(dist_ok && protective)

{

if(!Trade.PositionModify(ticket, newSL, tp) || Trade.ResultRetcode()!=10009)

Print("Trail modify failed: ", Trade.ResultRetcode(), " ", Trade.ResultRetcodeDescription());

}

}

}

}

}

//================ Trade tracking (wins/losses, streak) ================

void OnTradeTransaction(const MqlTradeTransaction& trans,

const MqlTradeRequest& request,

const MqlTradeResult& result)

{

if(trans.type != TRADE_TRANSACTION_DEAL_ADD) return;

ulong deal = trans.deal;

if(!HistoryDealSelect(deal)) return;

string sym = (string)HistoryDealGetString(deal, DEAL_SYMBOL);

if(sym != Sym) return;

long entry = (long)HistoryDealGetInteger(deal, DEAL_ENTRY);

double profit = HistoryDealGetDouble(deal, DEAL_PROFIT)

+ HistoryDealGetDouble(deal, DEAL_SWAP)

+ HistoryDealGetDouble(deal, DEAL_COMMISSION);

// count trades on CLOSE (DEAL_ENTRY_OUT) to avoid double-counting partial fills

if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_OUT_BY)

{

// avoid counting partial closes as full trade closes

ulong pos_id = (ulong)HistoryDealGetInteger(deal, DEAL_POSITION_ID);

if(PositionSelectByTicket(pos_id))

{

// position still open, skip counting

}

else

{

g_trades_total++;

g_today_trades_count++;

g_today_has_trade = true;

if(profit > 0.0)

{

g_trades_wins++;

g_consec_losses = 0;

g_consec_wins++;

}

else if(profit < 0.0)

{

g_consec_losses++;

g_consec_wins = 0;

}

}

}

}

//==================== Panel ==========================================

void DrawStatusPanel()

{

if(!DrawPanel) return;

string name = PANEL_ID;

if(ObjectFind(0,name)==-1)

{

ObjectCreate(0,name,OBJ_LABEL,0,0,0);

ObjectSetInteger(0,name,OBJPROP_CORNER,CORNER_LEFT_UPPER);

ObjectSetInteger(0,name,OBJPROP_XDISTANCE,8);

ObjectSetInteger(0,name,OBJPROP_YDISTANCE,8);

ObjectSetInteger(0,name,OBJPROP_FONTSIZE,9);

ObjectSetString(0,name,OBJPROP_FONT,"Arial");

}

double eq = AccountInfoDouble(ACCOUNT_EQUITY);

double day_delta_pct = 100.0*(eq - g_daily_start_equity)/g_daily_start_equity;

string txt;

txt = "FundingPips Scalper (EURUSD M15)\n";

txt += "Equity: " + DoubleToString(eq,2) + "\n";

txt += "Day P&L %: " + DoubleToString(day_delta_pct,2) + " Spread(pips): " + DoubleToString(SpreadPips(),2) + "\n";

txt += "Max DD % (day/total): " + DoubleToString(g_max_daily_drawdown_pct,2) + " / " + DoubleToString(g_max_total_drawdown_pct,2) + "\n";

txt += "Trades (wins): " + IntegerToString(g_trades_total) + " (" + IntegerToString(g_trades_wins) + ") Streak(L): " + IntegerToString(g_consec_losses) + "\n";

txt += "Days w/ trades: " + IntegerToString(g_trading_days_with_trades) + "\n";

// optional regime / pullback display

if(Use_MarketRegime)

{

double er,slope; er=EfficiencyRatio(ER_Period,1); slope=ADXSlope(ADX_Slope_Period,1);

txt += "Regime ER/Î”ADX: " + DoubleToString(er,2) + " / " + DoubleToString(slope,2) + "\n";

}

if(g_pending.active)

{

int bars_now = iBarShift(Sym, TF, TimeCurrent(), false);

int bars_exp = iBarShift(Sym, TF, g_pending.expire_time, false);

int bars_left = MathMax(0, bars_exp - bars_now);

txt += "Pullback: " + string(g_pending.isLong?"Long":"Short") + " @ " + DoubleToString(g_pending.entry_price, Dig()) + " BarsLeft: " + IntegerToString(bars_left) + "\n";

}

txt += "Halted: " + (g_daily_halted ? "YES" : "NO") + " NewsWindow: " + (InNewsWindow(TimeCurrent()) ? "YES" : "NO");

ObjectSetString(0,name,OBJPROP_TEXT,txt);

}

//==================== Lifecycle ======================================

int OnInit()

{

if(Sym!="EURUSD") Print("âš  Attach to EURUSD for consistency. Current symbol: ", Sym);

g_init_equity = AccountInfoDouble(ACCOUNT_EQUITY);

g_equity_highest = g_init_equity;

g_equity_lowest = g_init_equity;

if(!EnsureHandles()) return INIT_FAILED;

// initialize current day

StartNewDay(TimeCurrent());

EventSetTimer(10);

return INIT_SUCCEEDED;

}

void OnDeinit(const int reason)

{

EventKillTimer();

if(ObjectFind(0,PANEL_ID)!=-1) ObjectDelete(0,PANEL_ID);

if(g_pending.active && g_pending.order_ticket!=0)

{

if(!OrderSelect(g_pending.order_ticket))

{

// already gone

}

else

{

MqlTradeRequest req; MqlTradeResult res; ZeroMemory(req); ZeroMemory(res);

req.action=TRADE_ACTION_REMOVE; req.order=g_pending.order_ticket;

OrderSend(req,res);

}

}

if(hATR>0) IndicatorRelease(hATR);

if(hRSI>0) IndicatorRelease(hRSI);

if(hADX>0) IndicatorRelease(hADX);

if(hEMAfast>0) IndicatorRelease(hEMAfast);

if(hEMAslow>0) IndicatorRelease(hEMAslow);

if(hEMAfast_H4>0) IndicatorRelease(hEMAfast_H4);

if(hEMAslow_H4>0) IndicatorRelease(hEMAslow_H4);

if(hEMAfast_D1>0) IndicatorRelease(hEMAfast_D1);

if(hEMAslow_D1>0) IndicatorRelease(hEMAslow_D1);

}

void OnTimer()

{

// hook for calendar refresh or housekeeping if needed later

}

void OnTick()

{

datetime now = TimeCurrent();

MaybeRolloverDay(now);

if(!EnsureHandles()) return;

UpdateDrawdowns();

// process pending setups before entry attempts

ProcessPending();

ManageOpenPositions();

TryEntries();

DrawStatusPanel();

// cleanup closed position tracking records

for(int i=g_pos_track_count-1;i>=0;i--)

{

if(!PositionSelectByTicket(g_pos_track[i].ticket) || PositionGetString(POSITION_SYMBOL)!=Sym)

{

g_pos_track[i] = g_pos_track[g_pos_track_count-1];

g_pos_track_count--;

}

}

}

//==================== Pending processing ==============================

void ProcessPending()

{

if(!g_pending.active) return;

datetime now = TimeCurrent();

if(now > g_pending.expire_time)

{

if(g_pending.order_ticket!=0)

{

if(OrderSelect(g_pending.order_ticket))

{

MqlTradeRequest rq; MqlTradeResult rs; ZeroMemory(rq); ZeroMemory(rs);

rq.action=TRADE_ACTION_REMOVE; rq.order=g_pending.order_ticket;

OrderSend(rq,rs);

}

}

g_pending.active=false; g_pending.order_ticket=0; return;

}

// if we have a ticket, check whether it still exists (filled/canceled)

if(g_pending.order_ticket!=0)

{

if(!OrderSelect(g_pending.order_ticket))

{

// no longer in order pool â†’ filled or canceled

g_pending.active = false;

g_pending.order_ticket = 0;

}

return; // either still pending (do nothing) or just cleared (we're done)

}

// market-wait path

if(Use_PullbackEntry && !UsePendingLimitOrders)

{

// capacity re-check to avoid overfilling

if(PositionsTotalBySymbol(Sym) + OrdersTotalBySymbol(Sym) >= MaxOpenTrades)

return;

double price = g_pending.entry_price;

if(g_pending.isLong)

{

double bid = SymbolInfoDouble(Sym,SYMBOL_BID);

if(bid <= price)

{

double lots = ComputeLotsForEntry(RiskPctPerTrade, price, g_pending.sl_price, true);

if(lots>0)

{

int stops = (int)SymbolInfoInteger(Sym, SYMBOL_TRADE_STOPS_LEVEL);

double minDist = stops * _Point;

double ref = SymbolInfoDouble(Sym,SYMBOL_BID);

bool sl_ok = ((ref - g_pending.sl_price) >= minDist);

if(!sl_ok) return;

bool ok = Trade.Buy(lots, Sym, 0.0, g_pending.sl_price, g_pending.tp_price);

int rc = (int)Trade.ResultRetcode();

if(ok && (rc==10009 || rc==10008))

{ g_pending.active=false; g_pending.order_ticket=0; }

}

}

}

else

{

double ask = SymbolInfoDouble(Sym,SYMBOL_ASK);

if(ask >= price)

{

double lots = ComputeLotsForEntry(RiskPctPerTrade, price, g_pending.sl_price, false);

if(lots>0)

{

int stops = (int)SymbolInfoInteger(Sym, SYMBOL_TRADE_STOPS_LEVEL);

double minDist = stops * _Point;

double ref = SymbolInfoDouble(Sym,SYMBOL_ASK);

bool sl_ok = ((g_pending.sl_price - ref) >= minDist);

if(!sl_ok) return;

bool ok = Trade.Sell(lots, Sym, 0.0, g_pending.sl_price, g_pending.tp_price);

int rc = (int)Trade.ResultRetcode();

if(ok && (rc==10009 || rc==10008))

{ g_pending.active=false; g_pending.order_ticket=0; }

}

}

}

}

}

//==================== OnTester (custom reward) =======================

// Gates: Profit>=10%, MaxDailyDD<=3%, TotalDD<=6%, Trades>=MinTradesReq, TradingDays>=MinTradingDaysReq

double OnTester()

{

double end_eq = AccountInfoDouble(ACCOUNT_EQUITY);

double profit_pct = 100.0*(end_eq - g_init_equity)/g_init_equity;

// build daily return series

double mean=0.0, sd=0.0; int n=g_days_count;

for(int i=0;i<g_days_count;i++)

{

double ret = (g_days[i].end_eq - g_days[i].start_eq)/g_days[i].start_eq;

mean += ret;

}

if(n>0) mean/=n;

double var=0.0;

for(int i=0;i<g_days_count;i++)

{

double ret = (g_days[i].end_eq - g_days[i].start_eq)/g_days[i].start_eq;

var += (ret-mean)*(ret-mean);

}

if(n>1) sd = MathSqrt(var/(n-1));

double sharpe = (sd>0 ? mean/sd : 0.0);

bool pass =

(profit_pct >= 10.0) &&

(g_max_daily_drawdown_pct <= 3.0) &&

(g_max_total_drawdown_pct <= 6.0) &&

(g_trades_total >= MinTradesReq) &&

(g_trading_days_with_trades >= MinTradingDaysReq);

if(!pass) return -1000.0;

double dd_margin_pen =

2.0*MathMax(0.0, g_max_daily_drawdown_pct - 2.0) +

1.0*MathMax(0.0, g_max_total_drawdown_pct - 5.0);

double trade_pen = 0.05 * MathMax(0, g_trades_total - 80);

double winrate = (g_trades_total>0 ? (double)g_trades_wins/(double)g_trades_total : 0.0);

double bonus = 0.0;

if(sharpe > 1.5) bonus += 2.0;

if(winrate >= 0.60) bonus += 2.0;

double reward = profit_pct - dd_margin_pen - trade_pen + bonus;

return reward;

}
