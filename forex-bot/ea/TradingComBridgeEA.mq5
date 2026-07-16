//+------------------------------------------------------------------+
//| TradingComBridgeEA.mq5                                           |
//| File bridge + real OHLC export for Trading.com/MT5 on Mac/Wine.  |
//| v2.1: adds tc_positions.json export + CLOSE order support so an  |
//| external bot can see and manage positions through the bridge.    |
//+------------------------------------------------------------------+
#property strict
#property version   "2.100"

input bool   EA_DryRun = true;
input int    TimerSeconds = 5;
input ulong  MagicNumber = 26070801;
input int    DefaultDeviationPoints = 20;

input string SymbolsCsv = "EURUSD,GBPUSD,USDJPY,USDCHF,USDCAD,AUDUSD,NZDUSD";
input ENUM_TIMEFRAMES ExportTimeframe = PERIOD_M15;
input int    BarsToExport = 300;
input int    ExportEveryTimers = 1;

string HEARTBEAT_FILE = "tc_heartbeat.json";
string NEXT_ORDER_FILE = "tc_next_order.json";
string ORDER_REPORT_FILE = "tc_order_report.json";
string POSITIONS_FILE = "tc_positions.json";
int timer_count = 0;

string TfName()
{
   if(ExportTimeframe == PERIOD_M1) return "M1";
   if(ExportTimeframe == PERIOD_M5) return "M5";
   if(ExportTimeframe == PERIOD_M15) return "M15";
   if(ExportTimeframe == PERIOD_M30) return "M30";
   if(ExportTimeframe == PERIOD_H1) return "H1";
   if(ExportTimeframe == PERIOD_H4) return "H4";
   if(ExportTimeframe == PERIOD_D1) return "D1";
   return "M15";
}

string CleanSymbol(string s)
{
   StringTrimLeft(s);
   StringTrimRight(s);
   return s;
}

string JsonEscape(string s)
{
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   return s;
}

bool WriteText(const string filename, const string text)
{
   int h = FileOpen(filename, FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE)
   {
      Print("FileOpen write failed ", filename, " LastError=", GetLastError());
      return false;
   }
   FileWriteString(h, text);
   FileClose(h);
   return true;
}

bool ReadText(const string filename, string &text)
{
   if(!FileIsExist(filename))
      return false;

   int h = FileOpen(filename, FILE_READ | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE)
   {
      Print("FileOpen read failed ", filename, " LastError=", GetLastError());
      return false;
   }

   text = "";
   while(!FileIsEnding(h))
      text += FileReadString(h);

   FileClose(h);
   return true;
}

string JsonString(const string json, const string key, const string fallback="")
{
   string pattern = "\"" + key + "\"";
   int p = StringFind(json, pattern);
   if(p < 0) return fallback;
   p = StringFind(json, ":", p);
   if(p < 0) return fallback;
   p = StringFind(json, "\"", p);
   if(p < 0) return fallback;
   int q = StringFind(json, "\"", p + 1);
   if(q < 0) return fallback;
   return StringSubstr(json, p + 1, q - p - 1);
}

double JsonNumber(const string json, const string key, double fallback=0.0)
{
   string pattern = "\"" + key + "\"";
   int p = StringFind(json, pattern);
   if(p < 0) return fallback;
   p = StringFind(json, ":", p);
   if(p < 0) return fallback;

   int start = p + 1;
   while(start < StringLen(json))
   {
      ushort ch = StringGetCharacter(json, start);
      if(ch != ' ' && ch != '\t' && ch != '\r' && ch != '\n') break;
      start++;
   }

   int end = start;
   while(end < StringLen(json))
   {
      ushort ch = StringGetCharacter(json, end);
      if((ch >= '0' && ch <= '9') || ch == '-' || ch == '+' || ch == '.' || ch == 'e' || ch == 'E')
         end++;
      else
         break;
   }

   if(end <= start) return fallback;
   return StringToDouble(StringSubstr(json, start, end - start));
}

long JsonLong(const string json, const string key, long fallback=0)
{
   return (long)JsonNumber(json, key, (double)fallback);
}

bool JsonBool(const string json, const string key, bool fallback=false)
{
   string pattern = "\"" + key + "\"";
   int p = StringFind(json, pattern);
   if(p < 0) return fallback;
   p = StringFind(json, ":", p);
   if(p < 0) return fallback;
   string rest = StringSubstr(json, p + 1, 8);
   return StringFind(rest, "true") >= 0;
}

void SendHeartbeat()
{
   string payload = "{";
   payload += "\"account\":" + IntegerToString((long)AccountInfoInteger(ACCOUNT_LOGIN));
   payload += ",\"server\":\"" + JsonEscape(AccountInfoString(ACCOUNT_SERVER)) + "\"";
   payload += ",\"balance\":" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2);
   payload += ",\"equity\":" + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2);
   payload += ",\"margin_free\":" + DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2);
   payload += ",\"connected\":" + (TerminalInfoInteger(TERMINAL_CONNECTED) ? "true" : "false");
   payload += ",\"ea_dry_run\":" + (EA_DryRun ? "true" : "false");
   payload += ",\"time\":" + IntegerToString((long)TimeCurrent());
   payload += ",\"local_time\":" + IntegerToString((long)TimeLocal());
   payload += ",\"terminal\":\"" + JsonEscape(TerminalInfoString(TERMINAL_NAME)) + "\"";
   payload += "}";
   WriteText(HEARTBEAT_FILE, payload);
}

void ExportPositions()
{
   string payload = "{\"positions\":[";
   int total = PositionsTotal();
   bool first = true;
   for(int i = 0; i < total; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0)
         continue;
      if(!first) payload += ",";
      first = false;
      long ptype = PositionGetInteger(POSITION_TYPE);
      payload += "{";
      payload += "\"ticket\":" + IntegerToString((long)ticket);
      payload += ",\"symbol\":\"" + JsonEscape(PositionGetString(POSITION_SYMBOL)) + "\"";
      payload += ",\"side\":\"" + (ptype == POSITION_TYPE_BUY ? "BUY" : "SELL") + "\"";
      payload += ",\"volume\":" + DoubleToString(PositionGetDouble(POSITION_VOLUME), 2);
      payload += ",\"price_open\":" + DoubleToString(PositionGetDouble(POSITION_PRICE_OPEN), 10);
      payload += ",\"sl\":" + DoubleToString(PositionGetDouble(POSITION_SL), 10);
      payload += ",\"tp\":" + DoubleToString(PositionGetDouble(POSITION_TP), 10);
      payload += ",\"profit\":" + DoubleToString(PositionGetDouble(POSITION_PROFIT), 2);
      payload += ",\"swap\":" + DoubleToString(PositionGetDouble(POSITION_SWAP), 2);
      payload += ",\"time\":" + IntegerToString(PositionGetInteger(POSITION_TIME));
      payload += ",\"magic\":" + IntegerToString(PositionGetInteger(POSITION_MAGIC));
      payload += "}";
   }
   payload += "]}";
   WriteText(POSITIONS_FILE, payload);
}

void ExportSymbolInfo(const string symbol)
{
   if(!SymbolSelect(symbol, true))
      return;

   MqlTick tick;
   SymbolInfoTick(symbol, tick);

   string info = "{";
   info += "\"name\":\"" + JsonEscape(symbol) + "\"";
   info += ",\"point\":" + DoubleToString(SymbolInfoDouble(symbol, SYMBOL_POINT), 10);
   info += ",\"trade_tick_size\":" + DoubleToString(SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE), 10);
   info += ",\"trade_tick_value\":" + DoubleToString(SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE), 10);
   info += ",\"volume_min\":" + DoubleToString(SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN), 4);
   info += ",\"volume_max\":" + DoubleToString(SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX), 2);
   info += ",\"volume_step\":" + DoubleToString(SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP), 4);
   info += ",\"digits\":" + IntegerToString((int)SymbolInfoInteger(symbol, SYMBOL_DIGITS));
   info += ",\"bid\":" + DoubleToString(tick.bid, 10);
   info += ",\"ask\":" + DoubleToString(tick.ask, 10);
   info += ",\"last\":" + DoubleToString(tick.last, 10);
   info += "}";
   WriteText("tc_symbol_" + symbol + ".json", info);

   string tickj = "{";
   tickj += "\"symbol\":\"" + JsonEscape(symbol) + "\"";
   tickj += ",\"bid\":" + DoubleToString(tick.bid, 10);
   tickj += ",\"ask\":" + DoubleToString(tick.ask, 10);
   tickj += ",\"last\":" + DoubleToString(tick.last, 10);
   tickj += ",\"time\":" + IntegerToString((long)tick.time);
   tickj += ",\"written_at\":" + IntegerToString((long)TimeCurrent());
   tickj += "}";
   WriteText("tc_tick_" + symbol + ".json", tickj);
}

void ExportRatesForSymbol(const string symbol)
{
   if(!SymbolSelect(symbol, true))
      return;

   MqlRates rates[];
   ArraySetAsSeries(rates, false);

   int copied = CopyRates(symbol, ExportTimeframe, 0, BarsToExport, rates);
   if(copied <= 0)
   {
      Print("CopyRates failed for ", symbol, " LastError=", GetLastError());
      return;
   }

   string fn = "tc_rates_" + symbol + "_" + TfName() + ".csv";
   int h = FileOpen(fn, FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   if(h == INVALID_HANDLE)
   {
      Print("FileOpen rates failed ", fn, " LastError=", GetLastError());
      return;
   }

   FileWrite(h, "time", "open", "high", "low", "close", "tick_volume", "spread", "real_volume");

   for(int i = 0; i < copied; i++)
   {
      FileWrite(
         h,
         (long)rates[i].time,
         DoubleToString(rates[i].open, 10),
         DoubleToString(rates[i].high, 10),
         DoubleToString(rates[i].low, 10),
         DoubleToString(rates[i].close, 10),
         (long)rates[i].tick_volume,
         (int)rates[i].spread,
         (long)rates[i].real_volume
      );
   }

   FileClose(h);
   ExportSymbolInfo(symbol);
}

void ExportAllMarketData()
{
   string arr[];
   int n = StringSplit(SymbolsCsv, ',', arr);
   for(int i = 0; i < n; i++)
   {
      string sym = CleanSymbol(arr[i]);
      if(sym != "")
         ExportRatesForSymbol(sym);
   }
}

void ReportOrder(const long id, const string status, const string symbol, const string side, const double volume,
                 const long retcode, const string comment, const ulong order_ticket, const ulong deal_ticket)
{
   string payload = "{";
   payload += "\"id\":" + IntegerToString(id);
   payload += ",\"status\":\"" + JsonEscape(status) + "\"";
   payload += ",\"symbol\":\"" + JsonEscape(symbol) + "\"";
   payload += ",\"side\":\"" + JsonEscape(side) + "\"";
   payload += ",\"volume\":" + DoubleToString(volume, 2);
   payload += ",\"retcode\":" + IntegerToString(retcode);
   payload += ",\"comment\":\"" + JsonEscape(comment) + "\"";
   payload += ",\"order_ticket\":" + IntegerToString((long)order_ticket);
   payload += ",\"deal_ticket\":" + IntegerToString((long)deal_ticket);
   payload += ",\"ea_dry_run\":" + (EA_DryRun ? "true" : "false");
   payload += "}";
   WriteText(ORDER_REPORT_FILE, payload);
}

void HandleClose(const long id, const long ticket, const string order_comment, const int deviation)
{
   if(!PositionSelectByTicket((ulong)ticket))
   {
      ReportOrder(id, "EA_REJECTED_NO_POSITION", "", "CLOSE", 0, 0, "position not found", 0, 0);
      return;
   }

   string symbol = PositionGetString(POSITION_SYMBOL);
   double volume = PositionGetDouble(POSITION_VOLUME);
   long ptype = PositionGetInteger(POSITION_TYPE);

   if(EA_DryRun)
   {
      Print("FILE EA dry-run would CLOSE ticket ", ticket, " (", symbol, " ", DoubleToString(volume, 2), ")");
      ReportOrder(id, "EA_DRY_RUN", symbol, "CLOSE", volume, 0, "dry run only", 0, 0);
      return;
   }

   MqlTick tick;
   if(!SymbolInfoTick(symbol, tick))
   {
      ReportOrder(id, "EA_REJECTED_NO_TICK", symbol, "CLOSE", volume, 0, "SymbolInfoTick failed", 0, 0);
      return;
   }

   MqlTradeRequest req;
   MqlTradeResult res;
   ZeroMemory(req);
   ZeroMemory(res);

   req.action = TRADE_ACTION_DEAL;
   req.position = (ulong)ticket;
   req.symbol = symbol;
   req.volume = volume;
   req.type = (ptype == POSITION_TYPE_BUY) ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
   req.price = (ptype == POSITION_TYPE_BUY) ? tick.bid : tick.ask;
   req.deviation = deviation;
   req.magic = MagicNumber;
   req.comment = order_comment;
   req.type_time = ORDER_TIME_GTC;
   req.type_filling = ORDER_FILLING_IOC;

   bool ok = OrderSend(req, res);
   string status = ok ? "EA_SENT" : "EA_SEND_FAILED";
   ReportOrder(id, status, symbol, "CLOSE", volume, (long)res.retcode, res.comment, res.order, res.deal);
   ExportPositions();
}

void HandleModify(const long id, const long ticket, const double sl, const double tp)
{
   if(!PositionSelectByTicket((ulong)ticket))
   {
      ReportOrder(id, "EA_REJECTED_NO_POSITION", "", "MODIFY", 0, 0, "position not found", 0, 0);
      return;
   }

   string symbol = PositionGetString(POSITION_SYMBOL);
   double volume = PositionGetDouble(POSITION_VOLUME);

   if(EA_DryRun)
   {
      Print("FILE EA dry-run would MODIFY ticket ", ticket, " sl=", sl, " tp=", tp);
      ReportOrder(id, "EA_DRY_RUN", symbol, "MODIFY", volume, 0, "dry run only", 0, 0);
      return;
   }

   MqlTradeRequest req;
   MqlTradeResult res;
   ZeroMemory(req);
   ZeroMemory(res);

   req.action = TRADE_ACTION_SLTP;
   req.position = (ulong)ticket;
   req.symbol = symbol;
   req.sl = (sl > 0) ? sl : PositionGetDouble(POSITION_SL);
   req.tp = (tp > 0) ? tp : PositionGetDouble(POSITION_TP);

   bool ok = OrderSend(req, res);
   string status = ok ? "EA_SENT" : "EA_SEND_FAILED";
   ReportOrder(id, status, symbol, "MODIFY", volume, (long)res.retcode, res.comment, res.order, res.deal);
   ExportPositions();
}

void PollNextOrder()
{
   string body;
   if(!ReadText(NEXT_ORDER_FILE, body))
      return;

   if(!JsonBool(body, "has_order", false))
      return;

   long id = JsonLong(body, "id", 0);
   string symbol = JsonString(body, "symbol", "");
   string side = JsonString(body, "side", "");
   double volume = JsonNumber(body, "volume", 0.0);
   double sl = JsonNumber(body, "stop_loss", 0.0);
   double tp = JsonNumber(body, "take_profit", 0.0);
   long close_ticket = JsonLong(body, "ticket", 0);
   int deviation = (int)JsonLong(body, "deviation_points", DefaultDeviationPoints);
   long magic = JsonLong(body, "magic", (long)MagicNumber);
   string order_comment = JsonString(body, "comment", "tc_file_bridge");

   FileDelete(NEXT_ORDER_FILE);

   if(side == "CLOSE")
   {
      if(id <= 0 || close_ticket <= 0)
      {
         ReportOrder(id, "EA_REJECTED_BAD_PAYLOAD", symbol, side, volume, 0, "bad close payload", 0, 0);
         return;
      }
      HandleClose(id, close_ticket, order_comment, deviation);
      return;
   }

   if(side == "MODIFY")
   {
      if(id <= 0 || close_ticket <= 0)
      {
         ReportOrder(id, "EA_REJECTED_BAD_PAYLOAD", symbol, side, volume, 0, "bad modify payload", 0, 0);
         return;
      }
      HandleModify(id, close_ticket, sl, tp);
      return;
   }

   if(id <= 0 || symbol == "" || volume <= 0.0 || (side != "BUY" && side != "SELL"))
   {
      ReportOrder(id, "EA_REJECTED_BAD_PAYLOAD", symbol, side, volume, 0, "bad payload", 0, 0);
      return;
   }

   if(EA_DryRun)
   {
      Print("FILE EA dry-run would send ", side, " ", DoubleToString(volume, 2), " ", symbol, " sl=", sl, " tp=", tp);
      ReportOrder(id, "EA_DRY_RUN", symbol, side, volume, 0, "dry run only", 0, 0);
      return;
   }

   if(!SymbolSelect(symbol, true))
   {
      ReportOrder(id, "EA_REJECTED_SYMBOL_SELECT", symbol, side, volume, 0, "SymbolSelect failed", 0, 0);
      return;
   }

   MqlTick tick;
   if(!SymbolInfoTick(symbol, tick))
   {
      ReportOrder(id, "EA_REJECTED_NO_TICK", symbol, side, volume, 0, "SymbolInfoTick failed", 0, 0);
      return;
   }

   MqlTradeRequest req;
   MqlTradeResult res;
   ZeroMemory(req);
   ZeroMemory(res);

   req.action = TRADE_ACTION_DEAL;
   req.symbol = symbol;
   req.volume = volume;
   req.type = (side == "BUY") ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   req.price = (side == "BUY") ? tick.ask : tick.bid;
   req.sl = sl;
   req.tp = tp;
   req.deviation = deviation;
   req.magic = (ulong)magic;
   req.comment = order_comment;
   req.type_time = ORDER_TIME_GTC;
   req.type_filling = ORDER_FILLING_IOC;

   bool ok = OrderSend(req, res);
   string status = ok ? "EA_SENT" : "EA_SEND_FAILED";
   ReportOrder(id, status, symbol, side, volume, (long)res.retcode, res.comment, res.order, res.deal);
   ExportPositions();
}

int OnInit()
{
   EventSetTimer(MathMax(1, TimerSeconds));
   Print("TradingComBridgeEA v2.1 FILE + OHLC + POSITIONS MODE started. EA_DryRun=", EA_DryRun);
   Print("Files folder: ", TerminalInfoString(TERMINAL_DATA_PATH), "\\MQL5\\Files");
   SendHeartbeat();
   ExportPositions();
   ExportAllMarketData();
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   timer_count++;
   SendHeartbeat();
   ExportPositions();

   if(ExportEveryTimers <= 1 || (timer_count % ExportEveryTimers) == 0)
      ExportAllMarketData();

   PollNextOrder();
}
