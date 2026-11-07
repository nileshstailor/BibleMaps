"""Re-digitize kingdom regions from the plate: colour classification + cleanup.
Writes /tmp/labels_raw.png, /tmp/labels_clean.png and /tmp/labels.npy."""
import cv2, numpy as np
from scipy import ndimage as ndi

img = cv2.imread('/Users/nileshtailor/CursorApps/BibleMaps/media/historical/divided-kingdom.jpg')
H, W = img.shape[:2]
lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
L, A, B = lab[..., 0], lab[..., 1], lab[..., 2]

# class ids
CLASSES = ['bg', 'water', 'israel', 'judah', 'philistia', 'aram', 'phoenicia', 'ammon', 'moab', 'edom']
CID = {c: i for i, c in enumerate(CLASSES)}

# representative sample points (x, y) in full-res pixels; several per class for shading variety
SAMPLES = {
    'bg': [(1400, 1200), (600, 1900), (1300, 1700), (1450, 850), (100, 1900), (1400, 1400)],
    'water': [(300, 800), (876, 1250), (200, 1300), (940, 610)],
    'israel': [(800, 900), (1120, 840), (1250, 560), (900, 700), (1000, 1000), (1000, 1250), (760, 760), (860, 1000)],
    'judah': [(680, 1400), (500, 1660), (750, 1300), (600, 1750), (780, 1200)],
    'philistia': [(340, 1440), (560, 1130), (500, 1250), (250, 1560)],
    'aram': [(1200, 500), (1300, 300), (1050, 400), (1400, 150), (1150, 200)],
    'phoenicia': [(880, 300), (850, 200), (900, 100), (780, 500)],
    'ammon': [(1200, 1080), (1150, 1150), (1260, 1030)],
    'moab': [(1080, 1480), (1150, 1450), (1000, 1420), (1180, 1600)],
    'edom': [(1000, 1800), (950, 1700), (1050, 1900), (900, 1850)],
}

cents = []  # (class id, L, a, b)
for c, pts in SAMPLES.items():
    for (x, y) in pts:
        patch = lab[y - 6:y + 7, x - 6:x + 7].reshape(-1, 3)
        med = np.median(patch, 0)
        cents.append((CID[c], *med))
cents = np.array(cents, dtype=np.float32)

# Distance in (0.45*L, a, b)
WL = 0.45
feat = np.stack([WL * L, A, B], -1).reshape(-1, 3)
cfeat = np.stack([WL * cents[:, 1], cents[:, 2], cents[:, 3]], -1)
d2 = ((feat[:, None, :] - cfeat[None, :, :]) ** 2).sum(-1)  # (N, K)

# spatial priors: allowed row/col boxes (y0, y1, x0, x1); None = anywhere
BOX = {
    'bg': None, 'water': None,
    'israel': (300, 1400, 550, 1450),
    'judah': (1050, 1950, 250, 1000),
    'philistia': (950, 1750, 50, 720),
    'aram': (0, 720, 850, 1500),
    'phoenicia': (0, 720, 650, 1060),
    'ammon': (930, 1320, 1030, 1380),
    'moab': (1230, 1720, 820, 1320),
    'edom': (1480, 2000, 780, 1300),
}
yy, xx = np.mgrid[0:H, 0:W]
yy = yy.reshape(-1); xx = xx.reshape(-1)
for k in range(len(cents)):
    c = CLASSES[int(cents[k, 0])]
    box = BOX[c]
    if box is None:
        continue
    y0, y1, x0, x1 = box
    bad = ~((yy >= y0) & (yy < y1) & (xx >= x0) & (xx < x1))
    d2[bad, k] = np.inf

best = d2.argmin(1)
bestd = np.sqrt(d2[np.arange(len(best)), best])
labels = cents[best, 0].astype(np.int16).reshape(H, W)
bestd = bestd.reshape(H, W)

# unknown: far from any centroid, or achromatic extremes (text, halos, dots)
chroma = np.hypot(A - 128, B - 128)
unknown = (bestd > 16) | (L < 70) | ((L > 235) & (chroma < 10))
labels_raw = labels.copy()
labels_raw[unknown] = -1
np.save('/tmp/labels_raw.npy', labels_raw)

# --- cleanup -------------------------------------------------------------
# 1) fill unknown by nearest labelled pixel
idx = ndi.distance_transform_edt(unknown, return_distances=False, return_indices=True)
filled = labels[idx[0], idx[1]]

# 2) per-class open/close to kill thin junk, then Gaussian one-hot regularisation
K = len(CLASSES)
onehot = np.zeros((K, H, W), np.float32)
for k in range(K):
    m = (filled == k).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    onehot[k] = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 5)
reg = onehot.argmax(0).astype(np.int16)

# 3) keep the largest connected component per kingdom class; reassign the rest by nearest label
for k in range(2, K):
    m = (reg == k).astype(np.uint8)
    n, cc, stats, _ = cv2.connectedComponentsWithStats(m, connectivity=4)
    if n <= 2:
        continue
    areas = stats[1:, cv2.CC_STAT_AREA]
    keep = 1 + int(areas.argmax())
    drop = (cc != keep) & (cc != 0)
    reg[drop] = -1
if (reg == -1).any():
    idx = ndi.distance_transform_edt(reg == -1, return_distances=False, return_indices=True)
    reg = reg[idx[0], idx[1]]
# fill enclosed islands inside kingdom regions (label halos, Sea of Galilee): a hole
# traced from the plate would not line up with the basemap lake, so solid fills look better
for k in range(2, K):
    m = (reg == k).astype(np.uint8)
    n, cc, stats, _ = cv2.connectedComponentsWithStats((1 - m).astype(np.uint8), connectivity=4)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] < 12000:
            reg[cc == i] = k

np.save('/tmp/labels.npy', reg)

PALETTE = np.array([
    [235, 225, 205], [110, 150, 205], [170, 135, 140], [170, 175, 105], [232, 210, 130],
    [205, 120, 100], [218, 146, 95], [220, 170, 100], [165, 142, 110], [168, 118, 118]], np.uint8)

def render(lbl, path):
    out = np.zeros((H, W, 3), np.uint8)
    valid = lbl >= 0
    out[valid] = PALETTE[lbl[valid]]
    out[~valid] = (0, 0, 0)
    out = cv2.cvtColor(out, cv2.COLOR_RGB2BGR)
    cv2.imwrite(path, cv2.resize(out, (750, 1000), interpolation=cv2.INTER_NEAREST))

render(labels_raw, '/tmp/labels_raw.png')
render(reg, '/tmp/labels_clean.png')
print('unknown fraction', unknown.mean())
for k, c in enumerate(CLASSES):
    print(f'{c:10s} raw={int((labels_raw == k).sum()):8d} clean={int((reg == k).sum()):8d}')
