#!/bin/sh
#    Copyright 2019 Google LLC
#
#    Licensed under the Apache License, Version 2.0 (the "License");
#    you may not use this file except in compliance with the License.
#    You may obtain a copy of the License at
#
#        https://www.apache.org/licenses/LICENSE-2.0
#
#    Unless required by applicable law or agreed to in writing, software
#    distributed under the License is distributed on an "AS IS" BASIS,
#    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
#    See the License for the specific language governing permissions and
#    limitations under the License.

rm -rf all_models
mkdir -p all_models
cd all_models
wget --content-disposition https://tfhub.dev/tensorflow/ssd_mobilenet_v2/fpnlite_320x320/1?tf-hub-format=compressed
wget https://raw.githubusercontent.com/koush/coreml-survival-guide/master/MobileNetV2%2BSSDLite/coco_labels.txt
tar xzvf ssd_mobilenet_v2_fpnlite_320x320_1.tar.gz