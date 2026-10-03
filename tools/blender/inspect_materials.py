import bpy, json
from pathlib import Path
root=Path(__file__).resolve().parent/'out/reference-library'
for slug in ['logitech-g-pro-x-superlight-2','logitech-mx-master-3s','logitech-g203-lightsync']:
    source=json.loads((root/slug/'sources.json').read_text())
    bpy.ops.import_scene.gltf(filepath=str(root/source['arModels'][0]['file']))
    print('MODEL',slug)
    for obj in bpy.context.selected_objects:
        if obj.type!='MESH':continue
        for mat in obj.data.materials:
            node=next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
            if node:
                print(mat.name, [(key,list(node.inputs[key].default_value) if key=='Base Color' else node.inputs[key].default_value,[(link.from_node.type,link.from_node.name) for link in node.inputs[key].links]) for key in ['Base Color','Roughness','Metallic']])
                print([(n.type,n.image.name if n.type=='TEX_IMAGE' and n.image else '') for n in mat.node_tree.nodes])
