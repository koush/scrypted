import { SPSInfo } from "h264-sps-parser";

export function getSpsResolution(sps: SPSInfo) {
    let SubWidthC: number;
    let SubHeightC: number;

    if (sps.chroma_format_idc == 0 && sps.color_plane_flag == 0) { //monochrome
        SubWidthC = SubHeightC = 0;
    }
    else if (sps.chroma_format_idc == 1 && sps.color_plane_flag == 0) { //4:2:0 
        SubWidthC = SubHeightC = 2;
    }
    else if (sps.chroma_format_idc == 2 && sps.color_plane_flag == 0) { //4:2:2 
        SubWidthC = 2;
        SubHeightC = 1;
    }
    else if (sps.chroma_format_idc == 3) { //4:4:4
        if (sps.color_plane_flag == 0) {
            SubWidthC = SubHeightC = 1;
        }
        else if (sps.color_plane_flag == 1) {
            SubWidthC = SubHeightC = 0;
        }
    }

    let PicWidthInMbs = sps.pic_width_in_mbs;

    let PicHeightInMapUnits = sps.pic_height_in_map_units;
    let FrameHeightInMbs = (2 - sps.frame_mbs_only_flag) * PicHeightInMapUnits;

    let crop_left = 0;
    let crop_right = 0;
    let crop_top = 0;
    let crop_bottom = 0;

    if (sps.frame_cropping_flag) {
        crop_left = sps.frame_cropping.left;
        crop_right = sps.frame_cropping.right;
        crop_top = sps.frame_cropping.top;
        crop_bottom = sps.frame_cropping.bottom;
    }

    let width = PicWidthInMbs * 16 - SubWidthC * (crop_left + crop_right);
    let height = FrameHeightInMbs * 16 - SubHeightC * (2 - sps.frame_mbs_only_flag) * (crop_top + crop_bottom);

    return {
        width,
        height,
    };
}