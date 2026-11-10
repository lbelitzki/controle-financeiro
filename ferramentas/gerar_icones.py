# Gera os ícones PNG do app (sem dependências externas).
# Uso: python3 ferramentas/gerar_icones.py
import os, struct, zlib

def png(path, w, h, px):
    raw = b''.join(b'\x00' + bytes(px[y * w * 4:(y + 1) * w * 4]) for y in range(h))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

def desenhar(S, full_bleed=True):
    SS = 4  # supersampling
    N = S * SS
    out = bytearray(S * S * 4)
    top, bot = (0x16, 0x9B, 0x77), (0x0B, 0x5E, 0x48)
    # barras (x0, x1, y0) em fração do tamanho; base em 0.74
    barras = [(0.22, 0.34, 0.52), (0.42, 0.54, 0.38), (0.62, 0.74, 0.26)]
    base = 0.74
    r = 0.035
    for y in range(S):
        for x in range(S):
            acc = [0, 0, 0]
            for sy in range(SS):
                for sx in range(SS):
                    fx = (x * SS + sx + .5) / N
                    fy = (y * SS + sy + .5) / N
                    t = fy
                    c = [top[i] * (1 - t) + bot[i] * t for i in range(3)]
                    branco = False
                    for (x0, x1, y0) in barras:
                        if x0 <= fx <= x1 and y0 <= fy <= base:
                            # cantos arredondados no topo
                            if fy < y0 + r and (fx < x0 + r or fx > x1 - r):
                                cx = x0 + r if fx < x0 + r else x1 - r
                                if (fx - cx) ** 2 + (fy - (y0 + r)) ** 2 > r * r:
                                    continue
                            branco = True
                    if 0.18 <= fx <= 0.78 and base + 0.04 <= fy <= base + 0.07:
                        branco = True
                    if branco:
                        c = [255, 255, 255]
                    for i in range(3):
                        acc[i] += c[i]
            k = (y * S + x) * 4
            n = SS * SS
            out[k:k + 4] = bytes([round(acc[0] / n), round(acc[1] / n), round(acc[2] / n), 255])
    return out

aqui = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')
os.makedirs(aqui, exist_ok=True)
for nome, s in [('icon-512.png', 512), ('icon-192.png', 192), ('apple-touch-icon.png', 180)]:
    png(os.path.join(aqui, nome), s, s, desenhar(s))
    print('ok', nome)
