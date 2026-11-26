/** Widely held US-listed ETFs that the SEC's company list does not name one by one (a fund series shares its trust's filer id), so visitors'
 * watchlists and quote pages keep their prices (lib/research/market-guard.ts). Fund tickers only; a ticker the provider cannot serve simply
 * shows no price. Members and the owner are not limited to this list. */
export const MAJOR_ETFS: readonly string[] = [
  // Vanguard
  "VOO", "VTI", "VT", "VXUS", "VEA", "VWO", "VTV", "VUG", "VB", "VO", "VNQ", "VIG", "VYM", "VGT", "VHT", "VFH", "VDE", "VDC", "VCR", "VPU", "VOX",
  "VAW", "VIS", "VGK", "VPL", "BND", "BNDX", "VCIT", "VCSH", "VGIT", "VGSH", "VGLT", "VTEB", "VTIP", "VMBS", "VXF", "VBR", "VBK", "VOE", "VOT", "MGK",
  // iShares
  "IVV", "IWM", "IWF", "IWD", "IWB", "IWN", "IWO", "IWR", "IWS", "IWP", "IJH", "IJR", "IEFA", "IEMG", "EFA", "EEM", "AGG", "TLT", "IEF", "SHY", "LQD",
  "HYG", "TIP", "MBB", "EMB", "IAU", "SLV", "SOXX", "IBB", "IYR", "ITB", "IYW", "IGV", "ICLN", "EWJ", "EWZ", "EWT", "EWY", "FXI", "MCHI", "INDA",
  "ACWI", "USMV", "QUAL", "MTUM", "VLUE", "IXN", "IHI", "IYF", "IYH", "ITA", "SHV", "SGOV", "GOVT", "IGSB", "IBIT", "ETHA", "DGRO", "DVY", "HDV", "IGM",
  // SPDR
  "SPY", "SPLG", "SPYG", "SPYV", "MDY", "DIA", "XLK", "XLF", "XLE", "XLV", "XLY", "XLP", "XLI", "XLB", "XLU", "XLRE", "XLC", "XBI", "XME", "XOP", "XHB",
  "XRT", "XSD", "KRE", "KBE", "GLD", "GLDM", "SDY", "BIL", "JNK",
  // Invesco, Schwab, ARK, JPMorgan and others
  "QQQ", "QQQM", "RSP", "SPLV", "PGX", "PSI", "SCHD", "SCHX", "SCHB", "SCHG", "SCHV", "SCHA", "SCHF", "SCHE", "SCHP", "SCHZ", "ARKK", "ARKW", "ARKG",
  "ARKF", "ARKQ", "ARKB", "JEPI", "JEPQ", "NOBL", "COWZ", "MOAT", "PFF", "SMH", "FTEC", "FXL", "FDN", "CIBR", "HACK", "BOTZ", "ROBO", "SKYY", "CLOU",
  "URA", "LIT", "TAN", "KWEB", "JETS", "FBTC", "GBTC", "ETHE", "BITB", "BITO", "DGRW",
  // Leveraged and inverse index funds
  "TQQQ", "SQQQ", "QLD", "UPRO", "SPXL", "SPXU", "SSO", "SDS", "SOXL", "SOXS", "TNA", "TZA", "LABU", "TECL", "FAS", "UDOW", "SDOW", "TMF", "TBT",
  "UVXY", "VIXY", "SVXY",
];
