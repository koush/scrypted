import numpy as np
from common.softmax import softmax
class DFL:
    def __init__(self, c1=16):
        self.c1 = c1
        self.conv_weights = np.arange(c1).reshape(1, c1, 1, 1)

    def forward(self, x):
        b, _, a = x.shape  # batch, channels, anchors
        x = x.reshape(b, 4, self.c1, a).transpose(0, 2, 1, 3)
        x = softmax(x, axis=1)
        x = np.sum(self.conv_weights * x, axis=1)
        return x.reshape(b, 4, a)

def make_anchors(feats, strides, grid_cell_offset=0.5):
    anchor_points, stride_tensor = [], []
    assert feats is not None
    dtype = feats[0].dtype
    for i, stride in enumerate(strides):
        _, _, h, w = feats[i].shape
        sx = np.arange(w, dtype=dtype) + grid_cell_offset  # shift x
        sy = np.arange(h, dtype=dtype) + grid_cell_offset  # shift y
        sy, sx = np.meshgrid(sy, sx, indexing="ij")
        anchor_points.append(np.stack((sx, sy), axis=-1).reshape(-1, 2))
        stride_tensor.append(np.full((h * w, 1), stride, dtype=dtype))
    return np.concatenate(anchor_points), np.concatenate(stride_tensor)

def dist2bbox(distance, anchor_points, xywh=True, dim=-1):
    lt, rb = np.split(distance, 2, axis=dim)

    anchor_points = anchor_points.transpose(0, 2, 1)

    x1y1 = anchor_points - lt
    x2y2 = anchor_points + rb
    if xywh:
        c_xy = (x1y1 + x2y2) / 2
        wh = x2y2 - x1y1
        return np.concatenate((c_xy, wh), axis=dim)  # xywh bbox
    return np.concatenate((x1y1, x2y2), axis=dim)  # xyxy bbox

def decode_bbox(preds, img_shape):
    num_classes = next((o.shape[2] for o in preds if o.shape[2] != 64), -1)
    assert num_classes != -1, 'cannot infer postprocessor inputs via output shape if there are 64 classes'
    pos = [
        i for i, _ in sorted(enumerate(preds),
                            key=lambda x: (x[1].shape[2] if num_classes > 64 else -x[1].shape[2], -x[1].shape[1]))]
    x = np.transpose(
        np.concatenate([
            np.concatenate([preds[i] for i in pos[:len(pos) // 2]], axis=1),
            np.concatenate([preds[i] for i in pos[len(pos) // 2:]], axis=1)], axis=2), (0, 2, 1))
    reg_max = (x.shape[1] - num_classes) // 4
    dfl = DFL(reg_max) if reg_max > 1 else lambda x: x
    img_h, img_w = img_shape[-2], img_shape[-1]
    strides = [
        int(np.sqrt(img_shape[-2] * img_shape[-1] / preds[p].shape[1])) for p in pos if preds[p].shape[2] != 64]
    dims = [(img_h // s, img_w // s) for s in strides]
    fake_feats = [np.zeros((1, 1, h, w), dtype=preds[0].dtype) for h, w in dims]
    anchors, strides = make_anchors(fake_feats, strides, 0.5)

    strides_tensor = strides.transpose(1, 0)
    strides_tensor = np.expand_dims(strides_tensor, 0)

    dbox = dist2bbox(dfl.forward(x[:, :-num_classes, :]), anchors[None, ...], xywh=True, dim=1) * strides_tensor

    return np.concatenate((dbox, 1 / (1 + np.exp(-x[:, -num_classes:, :]))), axis=1)
