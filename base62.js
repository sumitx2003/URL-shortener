
const ALPHABET =
    "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

const BASE = 62;

// Convert a numeric ID into a short Base62 code
function encodeBase62(id) {
    if (!Number.isSafeInteger(id) || id < 0) {
        throw new Error("ID must be a non-negative safe integer");
    }

    if (id === 0) return "0";

    let code = "";

    while (id > 0) {
        const remainder = id % BASE;
        code = ALPHABET[remainder] + code;
        id = Math.floor(id / BASE);
    }

    return code;
}

// Convert a Base62 code back into its numeric ID
function decodeBase62(code) {
    if (typeof code !== "string" || code.length === 0) {
        throw new Error("Invalid Base62 code");
    }

    let id = 0;

    for (const char of code) {
        const value = ALPHABET.indexOf(char);

        if (value === -1) {
            throw new Error("Invalid Base62 character");
        }

        id = id * BASE + value;

        if (!Number.isSafeInteger(id)) {
            throw new Error("Decoded ID exceeds safe integer range");
        }
    }

    return id;
}

module.exports = { encodeBase62, decodeBase62 };
