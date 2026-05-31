export default interface TokenInfo {
    raw: string;    // literal text in source (may contain lone / separators)
    value: string;  // raw with lone / removed (matches simulator parser)
    start: number;  // start column (inclusive)
    end: number;    // end column (exclusive)
}