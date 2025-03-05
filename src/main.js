import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { gsap } from "gsap";
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { Group, TextureLoader } from 'three';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry';
import OpenAI from "openai";
import pluralize from 'pluralize';
import nlp from 'compromise';
import * as pdfjsLib from 'pdfjs-dist';
import { PCA } from 'ml-pca';
import compromise from 'compromise';


// Global variables
let camera, renderer, scene, controls, originalAspectRatio;
let isResizing = false;

let boxes = [];
let boundings = [];
let hoveredCube = null;
let clickedCube = null;
let currentGroup = null;


//resizing
const threejsContainer = document.getElementById('threejs-container');
const descriptionContainer = document.getElementById('description-container');
const resizeObserver = new ResizeObserver(() => {
  descriptionContainer.style.width = `${threejsContainer.offsetWidth * 0.8}px`; // Adjust width to 80% of threejsContainer
});
resizeObserver.observe(threejsContainer);



const resizer = document.getElementById('resizer');
const leftPanel = document.getElementById('pdf-container');
const rightPanel = document.getElementById('threejs-container');
const inputWord = document.getElementById('selectedInput');    

resizer.addEventListener('mousedown', (event) => {
  isResizing = true;

  document.body.style.userSelect = 'none';
  document.body.style.pointerEvents = 'none';

  document.addEventListener('mousemove', resize);
  document.addEventListener('mouseup', stopResize);
});

function resize(event) {
  if (isResizing) {
    let newWidth = event.clientX / window.innerWidth * 100; // Adjust based on clientX
    leftPanel.style.width = `${newWidth}%`;
    rightPanel.style.width = `${100 - newWidth}%`;

    const resizerRect = resizer.getBoundingClientRect();
    //document.getElementById("summary").style.left= `${resizerRect.left}px`;


    // Update canvas size and camera aspect ratio
    const rightPanelWidth = rightPanel.offsetWidth;
    const newHeight = rightPanelWidth / originalAspectRatio; // Maintain the aspect ratio




    // if (renderer && camera) {
    //   // Update renderer size
    //   renderer.setSize(rightPanelWidth, newHeight);
    //   // Update camera aspect ratio
    //   camera.aspect = rightPanelWidth / newHeight;
    //   camera.updateProjectionMatrix();
    // }

    // Ensure the canvas is positioned and sized correctly within the container
    const canvas = document.querySelector('#threejs-container canvas');
    // if (canvas) {
    //   canvas.style.width = `${rightPanelWidth}px`;
    //   canvas.style.height = `${newHeight}px`;
    // }
  }
}

function stopResize() {
  isResizing = false;

  document.body.style.userSelect = '';
  document.body.style.pointerEvents = '';

  document.removeEventListener('mousemove', resize);
  document.removeEventListener('mouseup', stopResize);
}

window.addEventListener('resize', () => {
  const rightPanelWidth = rightPanel.offsetWidth;
  const newHeight = rightPanelWidth / originalAspectRatio; // Maintain the aspect ratio
  // const newHeight = rightPanelWidth.offsetHeight;

  // Update renderer size and camera aspect ratio
  if (renderer && camera) {
    renderer.setSize(rightPanelWidth, newHeight);
    camera.aspect = rightPanelWidth / newHeight;
    camera.updateProjectionMatrix();
  }

  // Ensure the canvas is positioned and sized correctly
  const canvas = document.querySelector('#threejs-container canvas');
  if (canvas) {
    canvas.style.width = `${rightPanelWidth}px`;
    canvas.style.height = `${newHeight}px`;
  }
});







//pdf
let currentScale = 2; // Default zoom level
let currentPDF = null;
let selectedInput = '';

document.getElementById('pdfFile').addEventListener('change', function (event) {
    const file = event.target.files[0];
    if (file) {
        const fileReader = new FileReader();
        fileReader.onload = function () {
            const typedArray = new Uint8Array(this.result);
            pdfjsLib.getDocument(typedArray).promise.then(function (pdf) {
                currentPDF = pdf;
                renderPDF();
            });
        };
        fileReader.readAsArrayBuffer(file);
    }
});






function renderPDF() {
  if (!currentPDF) return;

  const container = document.getElementById('pdf-container');

  // Preserve buttons while clearing PDF pages
  const buttonsContainer = document.getElementById('pdf-buttons');
  if (!container.contains(buttonsContainer)) {
      container.appendChild(buttonsContainer);
  }

  // Remove only PDF content, keep buttons
  container.querySelectorAll('.pdf-page').forEach(page => page.remove());

  for (let i = 1; i <= currentPDF.numPages; i++) {
      currentPDF.getPage(i).then(function (page) {
          const pageWrapper = document.createElement('div');
          pageWrapper.classList.add('pdf-page');
          pageWrapper.style.position = 'relative';

          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          const textLayer = document.createElement('div');
          textLayer.classList.add('text-layer');

          pageWrapper.appendChild(canvas);
          pageWrapper.appendChild(textLayer);
          container.appendChild(pageWrapper);

          const viewport = page.getViewport({ scale: currentScale });
          canvas.width = viewport.width;
          canvas.height = viewport.height;

          const renderContext = {
              canvasContext: context,
              viewport: viewport,
          };

          page.render(renderContext).promise.then(() => {
              let imgData = context.getImageData(0, 0, canvas.width, canvas.height);
              let pixels = imgData.data;

              for (let j = 0; j < pixels.length; j += 4) {
                  pixels[j] = 255 - pixels[j];     // Red
                  pixels[j + 1] = 255 - pixels[j + 1]; // Green
                  pixels[j + 2] = 255 - pixels[j + 2]; // Blue
              }
              context.putImageData(imgData, 0, 0);

              // Adjust text layer scaling and positioning after rendering PDF
              textLayer.style.width = `${viewport.width}px`;
              textLayer.style.height = `${viewport.height}px`;
              textLayer.style.position = 'absolute';
              textLayer.style.top = `0px`;
              textLayer.style.left = `0px`;
              textLayer.style.pointerEvents = 'none';
              textLayer.style.userSelect = 'text';

              // Overlay text
              page.getTextContent().then(function (textContent) {
                textContent.items.forEach(function (textItem) {
                    const span = document.createElement('span');
                    const textDiv = document.createElement('div');
            
                    // Convert PDF coordinates to canvas coordinates
                    let [x, y] = page.getViewport({ scale: currentScale })
                      .convertToViewportPoint(textItem.transform[4], textItem.transform[5]);
            
                    // Adjust positioning slightly by adding/subtracting small offsets
                    const adjustedY = y - (textItem.height * currentScale) + (textItem.height / currentScale) - textItem.height * 0.3;
                    textDiv.style.left = `${x}px`;
                    textDiv.style.top = `${adjustedY}px`;
            
                    span.textContent = textItem.str;
                    span.style.position = 'absolute';
                    span.style.width = `${textItem.width * currentScale}px`;
                    span.style.display = 'inline-block';
            
                    textDiv.style.position = 'absolute';
                    textDiv.style.left = `${x}px`;
                    textDiv.style.top = `${adjustedY}px`; // Use adjustedY here
                    textDiv.style.fontSize = `${textItem.height * currentScale}px`;  // Adjust this more for precision
                    span.style.fontFamily = textItem.fontName || 'default-font';
                    span.style.fontWeight = textItem.fontWeight || 'normal';
                    span.style.fontStyle = textItem.fontStyle || 'normal';
                    textDiv.style.lineHeight = `${textItem.height * currentScale}px`;
                    textDiv.style.whiteSpace = 'nowrap';
                    textDiv.style.color = 'transparent'; // Make text invisible
                    textDiv.style.pointerEvents = 'all';
            

                    textDiv.appendChild(span);
                    textLayer.appendChild(textDiv);
                });
            });
          });
      });
  }
}



// Detect text selection
 document.addEventListener('mouseup', function () {
     const selectedText = window.getSelection().toString().trim();
     if (selectedText) {
        selectedInput = selectedText;
        console.log("Selected Word:", selectedInput);
        const selectedInputDiv = document.getElementById("summary");
        selectedInputDiv.innerHTML = `generate mappings for: <span style="color: #CF6A84">${selectedInput}</span>`;
      }
 });



document.getElementById('pdf-container').addEventListener('wheel', function (event) {
    if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        currentScale += event.deltaY < 0 ? 0.05 : currentScale > 0.5 ? -0.05 : 0;
        renderPDF();
    }
}, { passive: false });









// LLM
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

let stringifiedData = null;

let isRequestInProgress = false;




async function fetchSummary() {

  if (isRequestInProgress) {
    console.log("Request is already in progress. Please wait.");
    return;
  }
  
  isRequestInProgress = true;



  const fileInput = document.getElementById('pdfFile');
  const file = fileInput.files[0];

  if (!file) {
    alert("Please select a PDF file.");
    isRequestInProgress = false; // Reset flag
    return null;
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async function (event) {
      const arrayBuffer = event.target.result;

      try {
        console.log("PDF file loaded. Processing...");
        const pdfDocument = await pdfjsLib.getDocument(arrayBuffer).promise;
        const numPages = pdfDocument.numPages;

        let text = '';
        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
          const page = await pdfDocument.getPage(pageNum);
          const content = await page.getTextContent();
          const pageText = content.items.map(item => item.str).join(' ');
          text += pageText + '\n';
        }

        console.log("Selected Input:", selectedInput);
        if (!selectedInput) {
          console.error("selectedInput is undefined!");
          reject("Missing selectedInput");
          isRequestInProgress = false; // Reset flag
          return;
        }

        const response = await fetch('http://localhost:3000/process-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, selectedInput }),
        });

        console.log("API request sent. Awaiting response...");

        let data;
        try {
          data = await response.json();
        } catch (err) {
          console.error("Failed to parse JSON response:", err);
          reject("Invalid JSON format");
          isRequestInProgress = false; // Reset flag
          return;
        }

        console.log("Parsed API response:", JSON.stringify(data, null, 2));

        if (!Array.isArray(data)) {
          console.error("Unexpected response format:", data);
          reject("Invalid response format");
          isRequestInProgress = false; // Reset flag
          return;
        }

        resolve(data);

      } catch (error) {
        console.error("Error extracting text from PDF or fetching summary:", error);
        reject(error);
      }finally {
        isRequestInProgress = false; // Reset flag
      }
    };

    reader.onerror = function (event) {
      console.error("FileReader error:", event.target.error);
      reject(event.target.error);
      isRequestInProgress = false; // Reset flag
    };

    reader.readAsArrayBuffer(file);
  });
}


//  window.fetchSummary = fetchSummary;






// initialisation helper
async function initializePage() {
  const spinner = document.getElementById("loading-spinner");
  spinner.style.display = "block";

  let boxDataList = null;
  boxDataList = await fetchSummary();

  if (boxDataList) {
    console.log("Summary data:", boxDataList);
    spinner.style.display = "none";
    initializeThreeJS(boxDataList); // Pass the correct array
  } else {
    console.log("Error initializing Three.js");
  }
}



function clearContainer() {
  const container = document.getElementById('threejs-container');

  // Ensure the container exists before clearing
  if (container) {
    // Remove all child elements from the container
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
  }
}



function resetThreeScene() {
  if (!scene) return;

  // Dispose of all objects in the scene
  while (scene.children.length > 0) {
    const object = scene.children[0];

    if (object instanceof THREE.Mesh) {
      if (object.geometry) {
        object.geometry.dispose();
      }
      if (object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach(material => material.dispose());
        } else {
          object.material.dispose();
        }
      }
    }

    scene.remove(object);
  }

  // Dispose renderer properly
  if (renderer) {
    renderer.dispose();
    if (renderer.domElement) {
      renderer.domElement.remove(); // Remove canvas from the DOM
    }
    renderer = null;
  }

  // Reset essential elements
  camera = null;
  scene = new THREE.Scene(); // Ensure new scene is created

  // Clear stored arrays and variables
  if (typeof boxes !== "undefined") boxes.length = 0;
  if (typeof boundings !== "undefined") boundings.length = 0;
  hoveredCube = null;
  clickedCube = null;
  currentGroup = null;
}




  //three.js logic
function initializeThreeJS(boxDataList){

  //setup
  scene = new THREE.Scene();

  const width = container.clientWidth;
  const height = container.clientHeight;

  camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
  originalAspectRatio = width / height; // Save the original aspect ratio
  // scene.background = new THREE.Color(0x424949 );



  // camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.z = 25;
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(window.innerWidth - 18, window.innerHeight - 18);  
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.domElement.style.display = "block";  // Removes unwanted space below canvas
  renderer.domElement.style.position = "absolute";
  renderer.domElement.style.top = "50%";
  renderer.domElement.style.left = "50%";
  renderer.domElement.style.transform = "translate(-50%, -50%)";

  document.getElementById('threejs-container').appendChild(renderer.domElement);

  // Add buttons again
  // const rollButtonsContainer = document.getElementById('roll-buttons-container');
  // document.getElementById('threejs-container').appendChild(rollButtonsContainer);
  

  //light
  const ambientLight = new THREE.AmbientLight(0xffffff, 2); // Higher intensity for brighter illumination
  scene.add(ambientLight);
  
  const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x444444, 2); // Sky and ground light
  scene.add(hemisphereLight);


  //Variables
  const boxSize = 10;
  let targetPosition = new THREE.Vector3();
  let currentLookAt = new THREE.Vector3(0, 0, 0);  // Camera focus point

  // const boxes = [];
  // let hoveredCube = null;
  let structure = 0;
  let relations = 1;
  let themes = 2;
  let latent = 3;
  let sequence = 4;


  let mode = structure;
  let explore = false;

  // let boundings = [];
  // let clickedCube = null;
  // let currentGroup = null;

    //buttons
    const structureButton = document.getElementById("structure");
    const relationsButton = document.getElementById("relations");


    //colours
    const statusColorMap = {};
    let nextPreferredColorIndex = 0;

    const preferredColors = [
      '#e06666', 
      '#f3b48b', 
      '#c6e2ff', 
      '#e5cac6',
      '#d9d2e9'  
    ];

    const white = 0xFFFFFF; 
    const red = 0xFF0000;
    const blue = 0x0000FF;
    const green = 0x00FF00;
    const black = 0x000000;
    const hoverColor = 0xF7E0C0


  

  // bigCube
   // const bigCubeSize = 150; // Size of the big cube
    //const bigCubeGeometry = new THREE.BoxGeometry(bigCubeSize, bigCubeSize, bigCubeSize);
    //const bigCubeMaterial = new THREE.MeshBasicMaterial({ color: 0x555555, wireframe: true, transparent: true, opacity: 0 });
    //const bigCube = new THREE.Mesh(bigCubeGeometry, bigCubeMaterial);
    //scene.add(bigCube);  

    let bigCubeSize = 150; // Size of the big cube
    let bigCubeSizeSIM = 150;



//createBoxes
function createBox(name, description, status) {



let colour = white;

const normalizedName = normalizeEntityName(name);
const normalizedInput = normalizeEntityName(selectedInput);

// Check for adjective-noun merge
let docName = compromise(name);
let docInput = compromise(selectedInput);
let adjName = docName.adjectives().out('array');
let nounName = docName.nouns().out('array');
let adjInput = docInput.adjectives().out('array');
let nounInput = docInput.nouns().out('array');

// If both are adjective-noun pairs, compare them
const mergedName = adjName.length && nounName.length ? `${adjName[0]} ${nounName[0]}` : normalizedName;
const mergedInput = adjInput.length && nounInput.length ? `${adjInput[0]} ${nounInput[0]}` : normalizedInput;




// Use fuzzy matching to allow slight differences
if (jaroWinkler(mergedName, mergedInput) >= 0.85) {
  colour = 0xCF6A84;
}else if (status === 'related element' || status === 'superordinate element') {
  colour = 0x008080;
}



  // let colour = white;

   const geometry = new THREE.BoxGeometry(boxSize, boxSize, boxSize);
   const material = new THREE.MeshStandardMaterial({ color: colour, transparent: true,opacity: 1, wireframe: true });
   const cube = new THREE.Mesh(geometry, material);


  cube.userData.group = null;
  cube.userData.children = [];
  cube.userData.parents = [];
  cube.userData.name = name;
  cube.userData.description = description;
  cube.userData.status = status;
  cube.userData.relations=[]
  cube.userData.level = 0;
  cube.userData.outline = null;
  cube.userData.boundBox = null;
  cube.userData.colour = colour;
  cube.userData.statusline = null;
  cube.userData.sequence = [];
  cube.userData.permLines = [];


  boxes.push(cube);
  return cube;
}




// enhanceBox
function enhanceBox(name, parentes = [], relations = [[]], sequence = []) {

  let cube = boxes.find(box => box === name);

  // if (!cube) {
  //   console.error("Box not found, skipping enhancement.");
  //   return;
  // }


  //let cube = boxes.find(box => box.userData.name === name);


  //text
  const loader = new FontLoader();
  loader.load('src/courierPrime.json', function (font) {
    // Create text geometry
    const textGeometry = new TextGeometry(cube.userData.name, {
      font: font,
      size: boxSize * 1.5,
      height: 0.2,
      curveSegments: 12,
    });

    cube.geometry.dispose();
    cube.geometry = textGeometry;
    cube.material.transparent = false;
    cube.material.wireframe = false; 
    cube.geometry.center();
  
    //boundingBox
    const textBoundingBox = new THREE.Box3().setFromObject(cube);
    const size = new THREE.Vector3();
    textBoundingBox.getSize(size); 
    const boundingGeometry = new THREE.BoxGeometry(size.x *2, size.y *2, size.z *2);
    const boundingMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      wireframe: true,
      opacity: 0,
    }); 
    const boundBox = new THREE.Mesh(boundingGeometry, boundingMaterial);

    boundBox.position.copy(cube.position); 
    boundBox.userData = { isBoundingBox: true, parentCube: cube };
  
    scene.add(boundBox);
    boundings.push(boundBox);
    cube.userData.boundBox = boundBox;

  });

  //parents
    let parentReferences = [];
    parentes.forEach(parent => {
      if (parent) {
        parentReferences.push(parent);
      }
    })
    cube.userData.parents = parentReferences;


  //group
    const parentReferencesString = parentReferences.map(parent => parent?.userData?.name || 'extraElement').join(', ');
    cube.userData.group = parentReferencesString;


//children
    parentReferences = parentReferences ? (Array.isArray(parentReferences) ? parentReferences : [parentReferences]) : [];
      parentReferences.forEach(parent => {
      if (parent) {
        if (!parent.userData.children) {
          parent.userData.children = [];
        }
        parent.userData.children.push(cube);
        parent.add(cube); 
      }
    });


//relations
    if (Array.isArray(relations)) {
      relations.forEach(relation => {
          if (!Array.isArray(relation) || relation.length !== 2) {
              return;
          }
          const [entity, description] = relation;
          if (!entity || !description) {
              return;
          }
          cube.userData.relations.push([entity, description]);
          entity.userData.relations.push([cube, description]);
      });
  }





  //sequence
  sequence = sequence ? (Array.isArray(sequence) ? sequence : [sequence]) : [];
  sequence.forEach(seq => {
    cube.userData.sequence = sequence;
});



  //adding
  scene.add(cube);
  return cube;
    
}

console.log(boxDataList)




function updateZLevels() {
  function updateLevel(box) {
    if (!box.userData.parents.length) {
      console.log(`Root node detected: ${box.userData.name}`);
      box.userData.level = 0;
    } else {
      // Ensure parents exist before calculating level
      let validParents = box.userData.parents.filter(parent => parent.userData.level !== undefined);
      if (validParents.length === 0) {
        console.warn(`Parents of ${box.userData.name} are not assigned levels yet.`);
        return;
      }

      let maxParentLevel = Math.max(...validParents.map(parent => parent.userData.level));
      box.userData.level = maxParentLevel + 150; // Place child below lowest-level parent
      console.log(`${box.userData.name} is assigned level ${box.userData.level}`);
    }

    box.position.z = box.userData.level;
  }

  let remainingBoxes = [...boxes];

  while (remainingBoxes.length > 0) {
    let updatedBoxes = [];

    remainingBoxes.forEach(box => {
      let allParentsUpdated = box.userData.parents.every(parent => parent.userData.level !== undefined);
      if (allParentsUpdated) {
        updateLevel(box);
        updatedBoxes.push(box);
      }
    });

    remainingBoxes = remainingBoxes.filter(box => !updatedBoxes.includes(box));
  }
}





  // Click detection and navigation
  const raycaster = new THREE.Raycaster();
  raycaster.params.Mesh.threshold = 1.5; // Adjust threshold (default is 0)
  const mouse = new THREE.Vector2();
  window.addEventListener('mousemove', onMouseMove, false);


  function activateButton(button) {
    // Remove 'active' class from all buttons
    const buttons = document.querySelectorAll('#roll-buttons-container button');
    buttons.forEach(btn => btn.classList.remove('active'));
    
    // Add 'active' class to the clicked button
    button.classList.add('active');
  }




//changeMode
// structure button
document.getElementById('structure').addEventListener('click', () => {
    activateButton(document.getElementById('structure'));  
    mode = structure;
    structurePos();
    changeMode()
  
    const textContainer = document.getElementById('description-container');
    if (textContainer) {
     textContainer.innerHTML = `<span style="color: #F7E0C0">hierarchies</span>: This mapping shows hierarchical structures by sorting entities in superordinate and subordinate elements.`;
     textContainer.style.display = 'block'; // Ensure it's visible
   }
  
  });

// relations button
document.getElementById('relations').addEventListener('click', () => {
  activateButton(document.getElementById('relations'));
  mode = relations;
  changeMode()
  relationsPos();


   const textContainer = document.getElementById('description-container');
   if (textContainer) {
   textContainer.innerHTML = `<span style="color: #F7E0C0">dynamics</span>: This mapping shows non-structural relationships of influence and change between entities.`;
   textContainer.style.display = 'block'; // Ensure it's visible
 }


  });


// relations button
document.getElementById('types').addEventListener('click', () => {
  activateButton(document.getElementById('types'));
  mode = themes;
  themesPos();
  changeMode()

   const textContainer = document.getElementById('description-container');
   if (textContainer) {
   textContainer.innerHTML = `<span style="color: #F7E0C0">types</span>: This mapping shows the types of entities.`;
   textContainer.style.display = 'block'; // Ensure it's visible
 }


  });

//latent button
document.getElementById('latent').addEventListener('click', () => {
  activateButton(document.getElementById('latent'));
  latentPos();
  mode = latent;
  changeMode()


  const textContainer = document.getElementById('description-container');
  if (textContainer) {
   textContainer.innerHTML = `<span style="color: #F7E0C0">latent space</span>: This mapping combines the parameters of the other mappings and therefore shows overall similarity of entities in a latent space.`;
   textContainer.style.display = 'block'; // Ensure it's visible
 }


  });


  document.getElementById('sequence').addEventListener('click', () => {
    activateButton(document.getElementById('sequence'));
    sequencePos();
    mode = sequence;
    changeMode()


    const textContainer = document.getElementById('description-container');
    if (textContainer) {
     textContainer.innerHTML = `<span style="color: #F7E0C0">sequence</span>: This mapping shows sequential orders of entities.`;
     textContainer.style.display = 'block'; // Ensure it's visible
   }


    });
    




//mousemove and hover
function onMouseMove(event) {

  if (!renderer || !renderer.domElement) {
    console.warn('Renderer or its domElement is not initialized yet.');
    return;
  }

  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
    //const intersects = raycaster.intersectObjects(boxes);

  const intersects = raycaster.intersectObjects(boundings);

  if (intersects.length > 0) {
    let cube = intersects[0].object;

    if (cube.userData.isBoundingBox) {
      cube = cube.userData.parentCube;
    }
    if (hoveredCube !== cube) {
      removeHover(hoveredCube);

      onHover(cube);
      hoveredCube = cube;
    }
  } else {
    // Remove hover effects if no cube is intersected
    removeHover(hoveredCube);
    hoveredCube = null;
  }
}




function onHover(cube) {
  if (cube && cube.visible) {
   if (mode === structure) {
     createOutline(cube);
     cube.material.color.set(black);
     cube.userData.children?.forEach(child => {
      if(child !== null){
       createOutline(child)
       child.material.color.set(black);
       createLine(cube, child);
      }
   });
     cube.userData.parents?.forEach(parent => {
       if(parent !== null){
        createOutline(parent)
        parent.material.color.set(black);
         createLine(cube, parent);
       }
   });

   const textContainer = document.getElementById('description-container');

   let colC = `#${cube.userData.colour.toString(16).padStart(6, '0')}`;
   if (colC === '#ffffff') { 
       colC = '#F7E0C0';
   }

   if (textContainer) {
    textContainer.innerHTML = `<span style="color: ${colC}">${cube.userData.name}</span>: ${cube.userData.description}`;
    textContainer.style.display = 'block'; // Ensure it's visible

  }
  




   }


   if(mode === relations) {
     createOutline(cube);
     cube.material.color.set(black);


    cube.userData.relations?.forEach(([entity, description]) => {
      if (entity) {
        createOutline(entity);
        entity.material.color.set(black);
        createLine(cube, entity);
      }
    });
    const textContainer = document.getElementById('description-container');

    if (textContainer) {
      textContainer.innerHTML = ''; // Clear existing content
      cube.userData.relations?.forEach(([entity, description]) => {
        if(entity.visible){
        createOutline(entity);
        if (entity.visible && cube.visible) {
          createLine(cube, entity);
        }
          const descriptionElement = document.createElement('div');


          let colC = `#${cube.userData.colour.toString(16).padStart(6, '0')}`;
          if (colC === '#ffffff') { 
              colC = '#F7E0C0';
          }
          let colE = `#${entity.userData.colour.toString(16).padStart(6, '0')}`;
          if (colE === '#ffffff') { 
            colE = '#F7E0C0';
          }


        descriptionElement.innerHTML = `<span style="color: ${colC}">${cube.userData.name}</span>, <span style="color: ${colE}">${entity.userData.name}</span>: ${description}`;
      
        cube.material.color.getHex()
        textContainer.appendChild(descriptionElement);
      }
      });
  
      textContainer.style.display = 'block';
    }
  }
  if (mode === themes) {

    // boxes.filter(child => child.userData.status === cube.userData.status).forEach(element => {
    //   element.material.color.set(black);
    // })


    const boundingBox = new THREE.Box3();
    
    // Expand bounding box
    boxes.filter(child => child.userData.status === cube.userData.status)
         .forEach(state => boundingBox.expandByObject(state));
  
    //bounding box
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    boundingBox.getCenter(center);
    boundingBox.getSize(size);


    const boxGeometry = new THREE.BoxGeometry(size.x * 1.4, size.y * 1.4, size.z * 1.4);
    const edges = new THREE.EdgesGeometry(boxGeometry);
    const lineMaterial = new THREE.LineBasicMaterial({ color: hoverColor, linewidth: 4 });
  
    // const radius = Math.max(size.x, size.y) * 0.6; 
    // const segments = 64; // More segments for smoother circle
    // const circleGeometry = new THREE.CircleGeometry(radius, segments);

  
    // const circleMaterial = new THREE.MeshBasicMaterial({ 
    //   color: hoverColor, 
    //   transparent: false,
    //   opacity: 1,
    //   //side: THREE.DoubleSide 
    // });

  
    const statusOutline = new THREE.LineSegments(edges, lineMaterial);
    statusOutline.position.copy(center);
  
    // Add the outline to the scene
    scene.add(statusOutline);
    cube.userData.statusline = statusOutline;
  




    const textContainer = document.getElementById('description-container');
  

    let colC = `#${cube.userData.colour.toString(16).padStart(6, '0')}`;
    if (colC === '#ffffff') { 
        colC = '#F7E0C0';
    }


    if (textContainer) {
      textContainer.innerHTML = '';      
      const descriptionElement = document.createElement('div');
      descriptionElement.innerHTML = `<span style="color: ${colC}">${cube.userData.status}`;
      textContainer.appendChild(descriptionElement);
      textContainer.style.display = 'block';
    }
  }
  
  
  if(mode === sequence) {

    createOutline(cube);
    cube.material.color.set(black);

  tracePath(cube);

  
 }





  }
}



// helpers
// helpers
// helpers
// helpers
// helpers
// helpers
// helpers
// helperss
// helpers



const normalizeEntityName = (name) => {
  return pluralize.singular(name.toLowerCase());
};


function jaroWinkler(s1, s2) {
  let m = 0, t = 0, l = 0;
  let maxDist = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  let s1Matches = new Array(s1.length).fill(false);
  let s2Matches = new Array(s2.length).fill(false);

  for (let i = 0; i < s1.length; i++) {
      let start = Math.max(0, i - maxDist);
      let end = Math.min(i + maxDist + 1, s2.length);

      for (let j = start; j < end; j++) {
          if (s2Matches[j]) continue;
          if (s1[i] !== s2[j]) continue;
          s1Matches[i] = true;
          s2Matches[j] = true;
          m++;
          break;
      }
  }
  if (m === 0) return 0;

  let k = 0;
  for (let i = 0; i < s1.length; i++) {
      if (!s1Matches[i]) continue;
      while (!s2Matches[k]) k++;
      if (s1[i] !== s2[k]) t++;
      k++;
  }
  t /= 2;

  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
      if (s1[i] === s2[i]) l++;
      else break;
  }

  let jaro = ((m / s1.length) + (m / s2.length) + ((m - t) / m)) / 3;
  let jaroWinkler = jaro + l * 0.1 * (1 - jaro);
  return jaroWinkler;
}



function tracePath(cube, visited = new Set()) {
  if (visited.has(cube)) {
      return; // Stop recursion if this cube was already visited (prevents cycles)
  }

  visited.add(cube); // Mark this cube as visited

  let parents = boxes.filter(child => child.userData.sequence.includes(cube));

  if (parents.length === 0) {
      return;
  }

  parents.forEach(parent => {
    createOutline(parent);
    parent.material.color.set(black);
    createLine(cube, parent);

      // Recursively trace the path further
      tracePath(parent, visited);
  });
}















// navigation helpers
function addGridHelper(scene) {
  const gridHelper = new THREE.GridHelper(50, 10);
  scene.add(gridHelper);
}
const axesHelper = new THREE.AxesHelper( 500 );
//scene.add( axesHelper );
//addGridHelper(scene);



function generateRandomColor() {
  // // Generate a random hex color
  // return '#' + Math.floor(Math.random() * 16777215).toString(16);

  let colour = null;
  // Assign preferred color if available
  if (nextPreferredColorIndex < preferredColors.length) {
    colour = preferredColors[nextPreferredColorIndex];
    nextPreferredColorIndex++;
  } else {
    // Fallback to generating a random color if preferred list is exhausted
    colour = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
  }

  return colour;
}




function manNavigation() {

  let isDragging = false;
  let prevMousePosition = { x: 0, y: 0 };
  
  // const canvas = document.querySelector('canvas');
  
  
  const canvas = document.querySelector('#threejs-container canvas'); // Target the canvas inside the threejs-container


    // Check if the canvas exists
    if (!canvas) {
      console.error("Canvas not found! Ensure the Three.js canvas is created before calling manNavigation.");
      return;
    }
  
  canvas.addEventListener('wheel', (event) => {
    if (mode === structure && !explore) {
      camera.position.z += event.deltaY * 0.1; 
    }

    if (mode === relations && !explore) {
      camera.position.x -= event.deltaY * 0.1; 
    }

    if (mode === themes && !explore) {
      camera.position.z -= event.deltaY * 0.1; 
    }


    if (mode === latent && !explore) {
      camera.position.x += event.deltaY * 0.1; 
    }

    if (mode === sequence && !explore) {
      camera.position.y += event.deltaY * 0.1; 
    }

  });
  
  canvas.addEventListener('mousedown', (event) => {
    if (mode === structure && !explore) {
      isDragging = true;
      prevMousePosition.x = event.clientX;
      prevMousePosition.y = event.clientY;
    }

    if (mode === relations && !explore) {
      isDragging = true;
      prevMousePosition.x = event.clientX;
      prevMousePosition.y = event.clientY;
    }
    if (mode === themes && !explore) {
      isDragging = true;
      prevMousePosition.x = event.clientX;
      prevMousePosition.y = event.clientY;
    }

    if (mode === latent && !explore) {
      isDragging = true;
      prevMousePosition.x = event.clientX;
      prevMousePosition.y = event.clientY;
    }

    if (mode === sequence && !explore) {
      isDragging = true;
      prevMousePosition.x = event.clientX;
      prevMousePosition.y = event.clientY;
    }
  });
  
  canvas.addEventListener('mousemove', (event) => {
    if (mode === structure && !explore && isDragging) {
      const deltaX = (event.clientX - prevMousePosition.x) * 0.1; // Adjust drag sensitivity
      const deltaY = (event.clientY - prevMousePosition.y) * 0.1;
  
      // Modify camera's x and z positions based on drag
      camera.position.x -= deltaX;
      camera.position.y += deltaY;
  
      // Update previous mouse position
      prevMousePosition.x = event.clientX;
      prevMousePosition.y = event.clientY;
    }


    if (mode === relations && !explore && isDragging) {
      const deltaX = (event.clientX - prevMousePosition.x) * 0.1; // Adjust drag sensitivity
      const deltaY = (event.clientY - prevMousePosition.y) * 0.1;
  
      // Since the plane is rotated, modify the camera's z and y positions
      camera.position.z -= deltaX;
      camera.position.y += deltaY;
  
      // Update previous mouse position
      prevMousePosition.x = event.clientX;
      prevMousePosition.y = event.clientY;
    }

    if (mode === themes && !explore && isDragging) {
      const deltaX = (event.clientX - prevMousePosition.x) * 0.1; // Adjust drag sensitivity
      const deltaY = (event.clientY - prevMousePosition.y) * 0.1;
  
      // Modify camera's x and z positions based on drag
      camera.position.x += deltaX;
      camera.position.y += deltaY;
  
      // Update previous mouse position
      prevMousePosition.x = event.clientX;
      prevMousePosition.y = event.clientY;
    }

    if (mode === latent && !explore && isDragging) {
      const deltaX = (event.clientX - prevMousePosition.x) * 0.1; // Adjust drag sensitivity
      const deltaY = (event.clientY - prevMousePosition.y) * 0.1;
  
      // Since the plane is rotated, modify the camera's z and y positions
      camera.position.z += deltaX;
      camera.position.y += deltaY;
  
      // Update previous mouse position
      prevMousePosition.x = event.clientX;
      prevMousePosition.y = event.clientY;
    }

    if (mode === sequence && !explore && isDragging) {
      const deltaX = (event.clientX - prevMousePosition.x) * 0.1; // Adjust drag sensitivity
      const deltaY = (event.clientY - prevMousePosition.y) * 0.1;
  
      // Since the plane is rotated, modify the camera's z and y positions
      camera.position.x -= deltaX;
      camera.position.z -= deltaY;
  
      // Update previous mouse position
      prevMousePosition.x = event.clientX;
      prevMousePosition.y = event.clientY;
    }


  });
  
  canvas.addEventListener('mouseup', () => {
    if (mode === structure && !explore) isDragging = false;

    if (mode === relations && !explore) isDragging = false;

    if (mode === themes && !explore) isDragging = false;

    if (mode === latent && !explore) isDragging = false;

    if (mode === sequence && !explore) isDragging = false;


  });
  
  canvas.addEventListener('mouseleave', () => {
    if (mode === structure && !explore) isDragging = false;

    if (mode === relations && !explore) isDragging = false;

    if (mode === themes && !explore) isDragging = false;

    if (mode === latent && !explore) isDragging = false;

    if (mode === sequence && !explore) isDragging = false;


  });
};

function createConstantLines(startCube, endCube, color = 0xaeaeae) {
  const material = new THREE.LineBasicMaterial({ color, transparent: false, opacity: 0.2, depthWrite: false});
  const geometry = new THREE.BufferGeometry().setFromPoints([
    startCube.position.clone(),
    endCube.position.clone()
  ]);
  const line = new THREE.Line(geometry, material);
  line.renderOrder = 0;
  scene.add(line);

  // Store the line in userData of the startCube for cleanup
  if (!startCube.userData.permLines) {
    startCube.userData.permLines = []; // Initialize permLines if it doesn't exist
  }
  startCube.userData.permLines.push(line);
}



function removePermLines(cube) {
  if (cube && cube.userData.permLines && cube.userData.permLines.length > 0) {
    // Remove each line from the scene
    cube.userData.permLines.forEach(line => {
      scene.remove(line);
      line.geometry.dispose();  // Clean up geometry to prevent memory leaks
      line.material.dispose();  // Clean up material to prevent memory leaks
    });

    // Clear the permLines array
    cube.userData.permLines = []; // Reset the array after removal
  } else {
    console.log("No permanent lines to remove for cube:", cube);
  }
}






function showconnections() {

  if (mode === structure) {
    // Cleanup all previously created lines
    boxes.forEach(box => {
      removePermLines(box);
      if (box.userData.PermStatusline && box.userData.PermStatusline.length) {
        box.userData.PermStatusline.forEach(outline => scene.remove(outline));
        box.userData.PermStatusline = []; // Reset
      }
    });

    // Show connections (create new lines)
    setTimeout(() => {
    boxes.forEach(box => {
      if (box.userData.children) {
        box.userData.children.forEach(child => {
          createConstantLines(box, child);
        });
      }
    });
  }, 2000)




  } else if (mode === relations) {
    // Cleanup all previously created lines
    boxes.forEach(box => {
      removePermLines(box);
      if (box.userData.PermStatusline && box.userData.PermStatusline.length) {
        box.userData.PermStatusline.forEach(outline => scene.remove(outline));
        box.userData.PermStatusline = []; // Reset
      }
  
    });

    // Show connections (create new lines for relations)
    setTimeout(() => {
    boxes.forEach(box => {
      if (box.userData.relations) {
        box.userData.relations.forEach(([entity, description]) => {
          createConstantLines(box, entity);
        });
      }
    });
  }, 2000)


} else if (mode === themes) {
  boxes.forEach(box => {
    removePermLines(box);
    if (box.userData.PermStatusline && box.userData.PermStatusline.length) {
      box.userData.PermStatusline.forEach(outline => scene.remove(outline));
      box.userData.PermStatusline = []; // Reset
    }
  });

  // Show connections (create new lines)
  setTimeout(() => {
    boxes.forEach(box => {
      if (box.userData.status) {
        const boundingBox = new THREE.Box3();
        boxes
          .filter(child => child.userData.status === box.userData.status)
          .forEach(state => boundingBox.expandByObject(state));

        const center = new THREE.Vector3();
        const size = new THREE.Vector3();
        boundingBox.getCenter(center);
        boundingBox.getSize(size);

        const boxGeometry = new THREE.BoxGeometry(size.x * 1.4, size.y * 1.4, size.z * 1.4);
        const edges = new THREE.EdgesGeometry(boxGeometry);
        const lineMaterial = new THREE.LineBasicMaterial({ color: white, linewidth: 2, transparent: true, opacity: 0.3 });

        const statusOutline = new THREE.LineSegments(edges, lineMaterial);
        statusOutline.position.copy(center);

        // Store outline in an array
        if (!box.userData.PermStatusline) {
          box.userData.PermStatusline = [];
        }
        box.userData.PermStatusline.push(statusOutline);

        // Add to scene
        scene.add(statusOutline);
      }
    });
  }, 2000);




  }else if (mode === sequence) {

    boxes.forEach(box => {
      removePermLines(box);
     if (box.userData.PermStatusline && box.userData.PermStatusline.length) {
      box.userData.PermStatusline.forEach(outline => scene.remove(outline));
      box.userData.PermStatusline = []; // Reset
    }
      
    });

    setTimeout(() => {
      boxes.forEach(box => {
        if (box.userData.sequence) {
          box.userData.sequence.forEach(seq => {
            createConstantLines(box, seq);
          });
        }
      });
    }, 2000)
    

  } else if (mode === latent) {


    boxes.forEach(box => {
      removePermLines(box);
     if (box.userData.PermStatusline && box.userData.PermStatusline.length) {
      box.userData.PermStatusline.forEach(outline => scene.remove(outline));
      box.userData.PermStatusline = []; // Reset
    }
      
    });
  }
}







function changeMode() {
  const targetPosition = new THREE.Vector3(0,0,0);
  const rot = new THREE.Euler();


  if (mode === structure) {
    targetPosition.z +=  3* bigCubeSize;
    rot.set(0, 0, 0); // 90 degrees in radians

    let hiddenBoxes = boxes.filter(box => !box.visible);
    let structureBoxes = hiddenBoxes.filter(box => (box.userData.children.length > 0 || box.userData.parents.length > 0))
    structureBoxes.forEach(cube => easeInBoxes(cube));

    let notstructureBoxes = boxes.filter(box => (box.userData.children.length < 1 && box.userData.parents.length < 1))
    notstructureBoxes.forEach(cube =>  easeOutBoxes(cube));

    manNavigation();


    scene.getObjectByName('bigCubeMesh').visible = false;
    setTimeout(() => {
      scene.getObjectByName('bigCubeMesh').position.set(0,0,-30);
      scene.getObjectByName('bigCubeMesh').visible = true;
    }, 1500)

    showconnections()


  }


  if (mode === relations) {
    targetPosition.x -=  3* bigCubeSize;

    //rot.set(Math.PI / 2, -Math.PI / 2, Math.PI / 2); // 90 degrees in radians

    rot.set(0, -(Math.PI / 2), 0); // 90 degrees in radians



    boxes.forEach(box => easeInBoxes(box));
    boxes.filter(box => box.userData.relations.length < 1 ).forEach(box => box.visible = false); //&& box.userData.group !== "extraElement"


    manNavigation();

    scene.getObjectByName('bigCubeMesh').visible = false;
    setTimeout(() => {
      scene.getObjectByName('bigCubeMesh').position.set(30,0,0);
      scene.getObjectByName('bigCubeMesh').visible = true;
    }, 1500)

    showconnections()
  }

  if (mode === themes) {

    targetPosition.z -= 3* bigCubeSize;
    rot.set(0, - Math.PI, 0);

  
    boxes.forEach(box => easeInBoxes(box));
    manNavigation();

    scene.getObjectByName('bigCubeMesh').visible = false;
    setTimeout(() => {
      scene.getObjectByName('bigCubeMesh').position.set(0,0,30);
      scene.getObjectByName('bigCubeMesh').visible = true;
    }, 1500)

    showconnections()

  }

  if (mode === latent) {

    targetPosition.x += 3* bigCubeSize;
    rot.set(0, Math.PI / 2, 0);

    boxes.forEach(box => easeInBoxes(box));
    boxes.filter(box => box.userData.status === "helperElement" ).forEach(box => box.visible = false); //&& box.userData.group !== "extraElement"
    manNavigation();

    scene.getObjectByName('bigCubeMesh').visible = false;
    setTimeout(() => {
      scene.getObjectByName('bigCubeMesh').position.set(-30,0,0);
      scene.getObjectByName('bigCubeMesh').visible = true;
    }, 1500)

    showconnections()

  }

  if (mode === sequence) {

    targetPosition.y += 3* bigCubeSize;
    rot.set(-Math.PI / 2, 0, 0);

    boxes.forEach(box => box.visible = false);

    boxes.forEach(box => {
      if(box.userData.sequence.length > 0) {
        box.visible = true;
      }
    })

    boxes.forEach(box => {
      boxes.forEach(child => {
        if (child.userData.sequence.includes(box)) {
          box.visible = true;
        }
      });
    });

    manNavigation();

    scene.getObjectByName('bigCubeMesh').visible = false;
    setTimeout(() => {
      scene.getObjectByName('bigCubeMesh').position.set(0,-30,0);
      scene.getObjectByName('bigCubeMesh').visible = true;
    }, 1500)

  }


  showconnections()


  gsap.to(camera.position, {
    duration: 1, // Transition duration in seconds
    x: targetPosition.x,
    y: targetPosition.y,
    z: targetPosition.z,
    ease: "power2.inOut" // Smooth easing function
  });

  gsap.to(camera.rotation, {
    duration: 1,
    x: rot.x,
    y: rot.y,
    z: rot.z,
    ease: "power2.inOut"
  });
}



// structure explore helpers
function showChildGroupsOverlay(children, parent) {
  // Example: Dynamically create an HTML overlay with the available groups
  
  const existingOverlay = document.querySelector('.overlay');
  if (existingOverlay) {
    existingOverlay.remove();
  }

  // boxes.forEach(box => {
  //   box.visible = false;
  // });
  
  const overlay = document.createElement('div');
  overlay.classList.add('overlay');

  const groupSelection = document.createElement('div');
  groupSelection.classList.add('group-selection');
  overlay.appendChild(groupSelection);

  let posGroups = [];
  children.forEach(child => {
    if (!posGroups.includes(child.userData.group)) {
      posGroups.push(child.userData.group);
    }
  });

  posGroups.forEach(group => {
    const groupButton = document.createElement('button');
    groupButton.textContent = `Parents: ${group}`;  // Display the group number or name
    // groupButton.removeEventListener('click', previousHandler);
    groupButton.addEventListener('click', () => {
      event.stopPropagation();
      closeOverlay(overlay);
      updateCurrentGroup(group);  // Pass the selected group
      navigateToChildren(currentGroup, parent);      // Close the overlay after selection
    });
    groupSelection.appendChild(groupButton);
  });

  document.body.appendChild(overlay);
}

function updateCurrentGroup(selectedChildGroup) {
  currentGroup = selectedChildGroup;  // This group is chosen by the user
}

function closeOverlay(overlay) {
  overlay.style.display = 'none';  // Immediate hide
  setTimeout(() => {
    overlay.remove();  // Ensure removal
  }, 100);  // Delay for cleanup (short duration)
}


function navigateToChildren(selectedGroup, parent) {
  const children = parent.userData.children.filter(child => child.userData.group === selectedGroup);
  if (children.length === 0) return;

  boxes.forEach(cube => cube.visible = false);
  parent.visible = true;
  children.forEach(child => child.visible = true);

  const boundingBox = new THREE.Box3();
  children.forEach(child => boundingBox.expandByObject(child));

  const center = new THREE.Vector3();
  boundingBox.getCenter(center);
  const size = boundingBox.getSize(new THREE.Vector3()).length();

  const distance = size / (2 * Math.tan((camera.fov * Math.PI) / 360));
  targetPosition.set(center.x, center.y, center.z + distance + 5); // Extra space
  currentLookAt.copy(center);
}

function navigateToParent(selectedGroup) {
  const parentesGroup = boxes.filter(child => child.userData.group === selectedGroup);
  if (parentesGroup.length === 0) return;

  boxes.forEach(cube => cube.visible = false);
  parent.visible = true;
  parentesGroup.forEach(child => child.visible = true);

  const boundingBox = new THREE.Box3();
  parentesGroup.forEach(child => boundingBox.expandByObject(child));

  const center = new THREE.Vector3();
  boundingBox.getCenter(center);
  const size = boundingBox.getSize(new THREE.Vector3()).length();

  const distance = size / (2 * Math.tan((camera.fov * Math.PI) / 360));
  targetPosition.set(center.x, center.y, center.z + distance + 5); // Extra space
  currentLookAt.copy(center);
}




//easing animations
function easeInBoxes(cube) {
  cube.visible = true;
  cube.material.opacity = 0;
  cube.material.transparent = true;

  const totalDuration = 1000; // total fade-in duration in milliseconds
  const stepDuration = 20; // the interval between opacity updates
  let currentOpacity = 0;
  
  const fadeInInterval = setInterval(() => {
    currentOpacity += stepDuration / totalDuration; // increase opacity based on step duration
    cube.material.opacity = currentOpacity;

    // Once the opacity reaches 1, clear the interval
    if (currentOpacity >= 1) {
      clearInterval(fadeInInterval);
    }
  }, stepDuration);
}

function easeOutBoxes(cube) {
  cube.visible = true;
  cube.material.opacity = 1; // Start fully visible
  cube.material.transparent = true;

  const totalDuration = 700; // Total fade-out duration in milliseconds
  const stepDuration = 20; // The interval between opacity updates
  let currentOpacity = 1; // Start at full opacity
  
  const fadeOutInterval = setInterval(() => {
    currentOpacity -= stepDuration / totalDuration; // Gradually decrease opacity
    cube.material.opacity = currentOpacity;

    // Once the opacity reaches 0, clear the interval
    if (currentOpacity <= 0) {
      clearInterval(fadeOutInterval);
      cube.visible = false; // Hide the cube when opacity is 0
    }
  }, stepDuration);
}



// hovering
function createLine(startCube, endCube, color = hoverColor) {
  const material = new THREE.LineBasicMaterial({ color, linewidth: 3, opacity: 1,  depthWrite: false, });
  const geometry = new THREE.BufferGeometry().setFromPoints([
    startCube.position.clone(),
    endCube.position.clone()
  ]);
  const line = new THREE.Line(geometry, material);
  line.renderOrder = 0;
  scene.add(line);

  // Store the line in userData of the startCube for cleanup
  if (!startCube.userData.lines) {
    startCube.userData.lines = [];
  }
  startCube.userData.lines.push(line);
}

function removeLines(cube) {
  if (cube && cube.userData.lines) {
    cube.userData.lines.forEach(line => scene.remove(line));
    cube.userData.lines = null;
  }
}



function createOutline(cube) {
  let color = cube.material.color.getHex();
console.log(color)


  if(color === white) {
    color = 0xF7E0C0;
  }

  if (cube && !cube.userData.outline) {
    const box = new THREE.Box3().setFromObject(cube);

    // Get the dimensions of the bounding box
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    let factorX, factorY;
    if (mode === structure) {
      factorX = size.x;
      factorY = size.y;
    } else if (mode === relations) {
      factorX = size.z;
      factorY = size.y;
    } else if (mode === themes) {
      factorX = size.x;
      factorY = size.z;
    } else if (mode === latent) {
      factorX = size.z;
      factorY = size.y;
    }else if (mode === sequence) {
      factorX = size.x;
      factorY = size.z;
    }

    // Create a circle geometry (we'll scale it to make an oval)
    const circleGeometry = new THREE.CircleGeometry(1, 64);

    const boxgeometry = new THREE.BoxGeometry(size.x *1.3, size.y * 1.3, size.z * 1.3);

    // Create outline material
    const outlineMaterial = new THREE.MeshStandardMaterial({
      color,
      transparent: false,
      opacity: 0.5,
      depthWrite: true, // Ensures it doesn't block objects behind it
      side: THREE.DoubleSide // Make sure the outline is visible from both sides
    });

    // Create mesh and scale it to form an oval
    const outlineMesh = new THREE.Mesh(circleGeometry, outlineMaterial);
    outlineMesh.renderOrder = 1;
    

    // const outlineMesh = new THREE.Mesh(boxgeometry, outlineMaterial);


    outlineMesh.scale.set(factorX / 1.7, factorY / 0.7, 1);
    outlineMesh.position.copy(cube.position);
    scene.add(outlineMesh);

    // Save the outline for later removal
    cube.userData.outline = outlineMesh;

    // Set rotation based on mode
    if (mode === structure) {
      outlineMesh.rotation.set(0, 0, 0);
    } else if (mode === relations) {
      outlineMesh.rotation.set(0, -(Math.PI / 2), 0);
    } else if (mode === themes) {
      outlineMesh.rotation.set(0, -Math.PI, 0);
    } else if (mode === latent) {
    outlineMesh.rotation.set(0, Math.PI / 2, 0);
    } else if (mode === sequence) {
    outlineMesh.rotation.set(Math.PI / 2, 0, 0);
    }
  }
}




// function createOutline(cube, color = 0xF7E0C0) {
//   if (cube && !cube.userData.outline) {
//     const box = new THREE.Box3().setFromObject(cube);

//     // Get the dimensions of the bounding box
//     const size = new THREE.Vector3();
//     box.getSize(size);

//     // Create edges geometry for outline instead of a solid box
//     const outlineGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x * 1.3, size.y * 1.3, size.z * 1.3));
//     const outlineMaterial = new THREE.LineBasicMaterial({ color });

//     const outlineMesh = new THREE.LineSegments(outlineGeometry, outlineMaterial);

//     // Position it correctly
//     outlineMesh.position.copy(cube.position);

//     // Save the outline for later removal
//     cube.userData.outline = outlineMesh;

//     scene.add(outlineMesh);
//   }
// }





function removeOutline(cube) {
  if (cube && cube.userData.outline) {
    scene.remove(cube.userData.outline);
    cube.userData.outline = null;
  }
}

function removeHover(cube) {
  if (cube) {
    removeOutline(cube);
    cube.material.color.set(cube.userData.colour);
    removeLines(cube);

    cube.userData.children?.forEach(child => {
      if(child){
        removeOutline(child)
        child.material.color.set(child.userData.colour);
        removeLines(child);
      }
  });
    cube.userData.parents?.forEach(parent => {
      if(parent){
        removeOutline(parent)
        parent.material.color.set(parent.userData.colour);
        removeLines(parent);
      }
  });

  cube.userData.relations?.forEach(([entity, description]) => {
    if (entity) {
      removeOutline(entity);
      entity.material.color.set(entity.userData.colour);
      removeLines(entity);
    }
  });




  // function removetracePath(cube) {
  //   let parents = boxes.filter(child => child.userData.sequence.includes(cube));

  //   if (parents.length === 0) {
  //       return;
  //   }

  //   parents.forEach(parent => {
  //     removeOutline(parent);
  //     parent.material.color.set(parent.userData.colour);
  //     removeLines(parent);

  //       // Recursively trace the path further
  //       removetracePath(parent);
  //   });
  // }

  // removetracePath(cube);



  function removetracePath(cube, visited = new Set()) {
    if (visited.has(cube)) {
        return; // Stop recursion if this cube was already visited (prevents cycles)
    }

    visited.add(cube); // Mark this cube as visited

    let parents = boxes.filter(child => child.userData.sequence.includes(cube));

    if (parents.length === 0) {
        return;
    }

    parents.forEach(parent => {
        removeOutline(parent);
        parent.material.color.set(parent.userData.colour);
        removeLines(parent);

        // Recursively trace the path further
        removetracePath(parent, visited);
    });
}

removetracePath(cube);






  boxes.filter(child => child.userData.status === cube.userData.status).forEach(element => {
    element.material.color.set(element.userData.colour);
  })


  //text container
    const textContainer = document.getElementById('description-container');
    if (textContainer) {
      textContainer.style.display = 'none';
      textContainer.innerText = ''; // Clear the content
    }


    if (cube && cube.userData.statusline) {
      scene.remove(cube.userData.statusline);
      cube.userData.statusline = null;
    }
  
  }
}



// positions

//structure


function structurePos() {
  setTimeout(() => {
    // Reset rotation for all cubes
    boxes.forEach(cube => {
      cube.rotation.set(0, 0, 0);
      if (cube.userData.boundBox) {
        cube.userData.boundBox.rotation.set(0, 0, 0);
      }
    });

    const levelSpacing = boxSize * 10;   // Distance between levels (y-axis)
    const groupSpacing = boxSize * 2;   // Distance between groups (x-axis)
    const boxSpacing = boxSize / 3;      // Distance between boxes in clusters (x-axis)
    const zFrontFace = bigCubeSize / 2;

    const levels = {};

    let structureBoxes = boxes.filter(box => (box.userData.children.length > 0 || box.userData.parents.length > 0));
    let notStructureBoxes = boxes.filter(box => box.userData.group === "extraElement" && box.userData.children.length < 1);

    // Hide non-structural boxes
    notStructureBoxes.forEach(cube => { cube.visible = false; });

    // Group cubes by their level
    structureBoxes.forEach(cube => {
      const level = cube.userData.level;
      if (!levels[level]) levels[level] = [];
      levels[level].push(cube);
    });

    const totalLevels = Object.keys(levels).length;
    const totalHeight = (totalLevels - 1) * levelSpacing;
    const centerYOffset = totalHeight / 2;

    Object.keys(levels).forEach((yLevel, levelIndex) => {
      const cubesAtLevel = levels[yLevel];
      const clusters = {};

      // Group cubes by `group`
      cubesAtLevel.forEach(cube => {
        const cluster = cube.userData.group;
        if (!clusters[cluster]) clusters[cluster] = [];
        clusters[cluster].push(cube);
      });

      let totalWidth = 0;
      let maxClusterHeight = 0;

      // Calculate total width and max height for the level
      Object.values(clusters).forEach(cubesInCluster => {
        let clusterWidth = 0;
        let clusterHeight = 0;
        cubesInCluster.forEach(cube => {
          if (!cube.userData.boundBox.geometry.boundingBox) {
            cube.userData.boundBox.geometry.computeBoundingBox();
          }
          const boundBox = cube.userData.boundBox.geometry.boundingBox;
          clusterWidth += boundBox.max.x - boundBox.min.x + boxSpacing;
          clusterHeight = Math.max(clusterHeight, boundBox.max.y - boundBox.min.y);
        });
        totalWidth += clusterWidth;
        maxClusterHeight = Math.max(maxClusterHeight, clusterHeight);
      });

      totalWidth += (Object.keys(clusters).length - 1) * groupSpacing;
      const levelOffsetX = -totalWidth / 2;
      let currentX = levelOffsetX;

      Object.keys(clusters).forEach(clusterKey => {
        const cubesInCluster = clusters[clusterKey];
        let clusterWidth = 0;

        cubesInCluster.forEach((cube, i) => {
          if (!cube.userData.boundBox.geometry.boundingBox) {
            cube.userData.boundBox.geometry.computeBoundingBox();
          }
          const boundBox = cube.userData.boundBox.geometry.boundingBox;
          const cubeWidth = boundBox.max.x - boundBox.min.x;
          const cubeHeight = boundBox.max.y - boundBox.min.y;

          const x = currentX + clusterWidth + cubeWidth / 2;
          const y = centerYOffset - levelIndex * levelSpacing - (maxClusterHeight - cubeHeight) / 2;
          const z = zFrontFace;

          // Animate the cube's position
          gsap.to(cube.position, {
            duration: 1,
            x: x,
            y: y,
            z: z,
            ease: "power2.inOut",
            onUpdate: () => {
              if (cube.userData.boundBox) {
                cube.userData.boundBox.position.copy(cube.position);
              }
            }
          });

          clusterWidth += cubeWidth + boxSpacing;
        });

        currentX += clusterWidth + groupSpacing;
      });
    });
  }, 500);
}


function structureExplorePos() {
  // setTimeout(() => {
  const levelSpacing = 50; // Distance between levels on the z-axis
  const groupSpacing = 50; // Distance between groups within a level
  const boxSpacing = 15;    // Distance between boxes within a cluster

//rotation
boxes.forEach(cube => {
  cube.rotation.set(0, 0, 0);
  cube.userData.boundBox.rotation.set(0, 0, 0);

});


  const levels = {};


  // let structureBoxes = boxes.filter(box => box.userData.group !== "extraElement");
  
  // let notStructureBoxes = boxes.filter(box => box.userData.group === "extraElement");

  let structureBoxes = boxes.filter(box => box.userData.children.length > 0 || box.userData.parents.length > 0)//(box => box.userData.group !== "extraElement");
  
  let notStructureBoxes = boxes.filter(box => box.userData.group === "extraElement" && box.userData.children.length < 1);

  notStructureBoxes.forEach(cube => {cube.visible = false;});



  structureBoxes.forEach(cube => {
    const level = cube.userData.level;
    if (!levels[level]) levels[level] = [];
    levels[level].push(cube);
  });

  Object.keys(levels).forEach((zLevel, levelIndex) => {
    const cubesAtLevel = levels[zLevel];

    // Group cubes by their `group` value
    const clusters = {};
    cubesAtLevel.forEach(cube => {
      const cluster = cube.userData.group;
      if (!clusters[cluster]) clusters[cluster] = [];
      clusters[cluster].push(cube);
    });

    const totalWidth = Object.keys(clusters).length * groupSpacing;
      const levelOffsetX = -totalWidth / 2;

    Object.keys(clusters).forEach((clusterKey, clusterIndex) => {
      const cubesInCluster = clusters[clusterKey];

      const clusterOffsetX = levelOffsetX + clusterIndex * groupSpacing;

      const cols = Math.ceil(Math.sqrt(cubesInCluster.length));
      cubesInCluster.forEach((cube, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);

        const x = clusterOffsetX + col * boxSpacing;
        const y = row * boxSpacing;
        const z = -levelIndex * levelSpacing; // Place at the correct z-level



        gsap.to(cube.position, {
          duration: 1,
          x: x,
          y: y,
          z: z,
          ease: "power2.inOut",
          onUpdate: () => { 
              boxes.forEach(box => {
                box.userData.boundBox.position.copy(box.position);
              })   
           }
        });

        // Set the position of the cube
        // cube.position.set(x, y, z);
      });
    });
  });
// }, 500);
}








//relations
function relationsPos() {
  setTimeout(() => {
    // Rotate cubes
    let relationBoxes = boxes.filter(box => box.userData.relations.length > 0);

    relationBoxes.forEach(cube => cube.visible = true)

    boxes.forEach(cube => {
      cube.rotation.set(0, -(Math.PI / 2), 0);
      cube.userData.boundBox.rotation.set(0, -(Math.PI / 2), 0);
    });


    boxes.forEach(cube => {
      cube.rotation.set(0, -(Math.PI / 2), 0);
      cube.userData.boundBox.rotation.set(0, -(Math.PI / 2), 0);
    });




    let corpus = boxes.map(box => {
      let allWords = [];
      
      if (box.userData.relations) {
        box.userData.relations.forEach(([rel, description]) => {
          allWords = [...allWords, ...description.split(" ")];
        });
      }
      return allWords.filter(Boolean); // Remove empty entries
    });
    


    let pcaPositions = pcaText(corpus);

    if (!pcaPositions || pcaPositions.length === 0) {
      console.error("PCA positions not generated correctly.");
  }
  
    pcaPositions.forEach(pos => {
      pos.x = pos.x * 2;
      pos.y = pos.y * 2;
    })

    //let adjustedPositions = adjustPos(pcaPositions, "relations");

    let finalPositions = overlapPrevention(pcaPositions);



    let face = - (bigCubeSize / 2);

    boxes.forEach(cube => {
      finalPositions.forEach((pos, index) => {
        if (cube.userData.name === pos.boxName) {
            gsap.to(cube.position, {
              duration: 1,
              x: face,
              y: pos.y,
              z: pos.x,
              ease: "power2.inOut",
              onUpdate: () => {
                cube.userData.boundBox.position.copy(cube.position);
              }
            });
        }
      });
    });

  }, 500);
}


function relationsExplorePos() {
  // rotation reset
  boxes.forEach(cube => {
    cube.rotation.set(0, - (Math.PI / 2), 0);
    cube.userData.boundBox.rotation.set(0, - (Math.PI / 2), 0);
  });
 
    //const groupCenterObject = boxes.find(cube => cube.userData.group === currentGroup);

    const groupCenterObject = clickedCube;



    if (!groupCenterObject) return;
    groupCenterObject.position.set(0, 0, 0);  // Center position
    const relatedObjects = [];

    groupCenterObject.userData.relations.forEach(([relatedCube]) => {
      if (relatedCube !== groupCenterObject && !relatedObjects.includes(relatedCube)) {
        relatedObjects.push(relatedCube);
      }
    })

    const radius = 50;  // The radius of the circle around the center
    const angleIncrement = (2 * Math.PI) / relatedObjects.length;

    relatedObjects.forEach((relatedCube, index) => {
      const angle = angleIncrement * index;
      const x = 0;
      const z = radius * Math.cos(angle);
      const y = radius * Math.sin(angle);

      gsap.to(relatedCube.position, {
        duration: 1,
        x: x,
        y: y,
        z: z,
        ease: "power2.inOut",
        onUpdate: () => {
          boxes.forEach(box => {
           box.userData.boundBox.position.copy(box.position);
          })   
        } 
      });
    });

    boxes.forEach(cube => {cube.visible = false});
    groupCenterObject.visible = true;
    relatedObjects.forEach(cube => cube.visible = true);
}



function themesPos() {
  setTimeout(() => {

    boxes.forEach(cube => {
      cube.rotation.set(0, -Math.PI, 0);
      cube.userData.boundBox.rotation.set(0, -Math.PI, 0);
    });


    // Base constants
    const baseClusterSpacing = boxSize * 10; // Spacing between cluster centers
    const baseBoxSpread = boxSize * 7; // Initial spread within clusters
    const minClusterDistance = boxSize * 3; // Minimum distance between cluster centers
    const faceZ = -bigCubeSize / 2;

    // Group cubes by status
    const statusClusters = {};
    boxes.forEach(cube => {     //themesBoxes?????
      const status = cube.userData.status || "default";
      if (!statusClusters[status]) statusClusters[status] = [];
      statusClusters[status].push(cube);
    });

    const statusKeys = Object.keys(statusClusters);

    // Initialize cluster centers
    const clusterCenters = statusKeys.map((status, index) => {
      const angle = (index / statusKeys.length) * Math.PI * 2;
      const radius = baseClusterSpacing * Math.sqrt(statusKeys.length);
      return new THREE.Vector3(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        faceZ
      );
    });

    // Force-directed placement of cluster centers
    for (let iteration = 0; iteration < 100; iteration++) {
      statusKeys.forEach((status, i) => {
        let forceX = 0, forceY = 0;
        statusKeys.forEach((otherStatus, j) => {
          if (i !== j) {
            const dx = clusterCenters[i].x - clusterCenters[j].x;
            const dy = clusterCenters[i].y - clusterCenters[j].y;
            const distance = Math.sqrt(dx * dx + dy * dy) || 1;
            const force = Math.max(0, minClusterDistance - distance) / distance;
            forceX += dx * force;
            forceY += dy * force;
          }
        });
        clusterCenters[i].x += forceX * 0.1;
        clusterCenters[i].y += forceY * 0.4;
      });
    }

    // Position cubes within clusters
    statusKeys.forEach((status, clusterIndex) => {
      const cubesInStatus = statusClusters[status];
      const clusterCenter = clusterCenters[clusterIndex];

      // Initialize positions within cluster
      cubesInStatus.forEach(cube => {
        cube.position.x = clusterCenter.x + (Math.random() - 0.5) * baseBoxSpread;
        cube.position.y = clusterCenter.y + (Math.random() - 0.5) * baseBoxSpread;
        cube.position.z = faceZ;
      });

      // Force-directed placement within cluster
      for (let iteration = 0; iteration < 50; iteration++) {
        cubesInStatus.forEach((cube, i) => {
          let forceX = 0, forceY = 0;
          
          cubesInStatus.forEach((otherCube, j) => {
            if (i !== j) {
              const dx = cube.position.x - otherCube.position.x;
              const dy = cube.position.y - otherCube.position.y;
              const distance = Math.sqrt(dx * dx + dy * dy) || 1;
              const force = (30 - distance) / distance;
              forceX += dx * force;
              forceY += dy * force;
            }
          });

          // Add a centering force
          forceX += (clusterCenter.x - cube.position.x) * 0.1;
          forceY += (clusterCenter.y - cube.position.y) * 0.1;

          cube.position.x += forceX * 0.05;
          cube.position.y += forceY * 0.05;
        });
      }

      // Animate final positions
      cubesInStatus.forEach(cube => {
        gsap.to(cube.position, {
          duration: 1,
          x: cube.position.x,
          y: cube.position.y,
          z: cube.position.z,
          ease: "power2.inOut",
          onUpdate: () => {
            cube.userData.boundBox.position.copy(cube.position);
          }
        });
      });
    });

    // Update bounding boxes and outlines
    updateBoundingBoxes();
  }, 500);
}



function latentPos() {
  setTimeout(() => {
    
  
  boxes.forEach(cube => {
    cube.visible = true
    cube.rotation.set(0, Math.PI / 2, 0);
    cube.userData.boundBox.rotation.set(0, Math.PI, 0);
  });


  let corpus = boxes.map(box => {
    let allWords = [
      ...box.userData.description.split(" "),];
    
    if (box.userData.relations) {
      box.userData.relations.forEach(([rel, description]) => {
        allWords = [...allWords, ...description.split(" ")];
      });

    if (box.userData.status) {
        allWords = [...allWords, ...box.userData.status.split(" ")];
      }

    }
    return allWords.filter(Boolean); // Remove empty entries
  });



  let pcaPositions = pcaText(corpus);

  if (!pcaPositions || pcaPositions.length === 0) {
    console.error("PCA positions not generated correctly.");
}


  pcaPositions.forEach(pos => {
    pos.x = pos.x * 1.5;
    pos.y = pos.y * 1.5;
  })

  let relPositions = adjustPos(pcaPositions, "relations");
  let parentsPositions = adjustPos(relPositions, "parents");
 // let childrenPositions = adjustPos(parentsPositions, "children");
  let sequencePositions = adjustPos(parentsPositions, "sequence");


  let finalPositions = overlapPrevention(sequencePositions);


  // let finalPositions = overlapPrevention(parentsPositions);


  let face = bigCubeSize / 2;

  boxes.forEach(cube => {
    finalPositions.forEach((pos, index) => {
      if (cube.userData.name === pos.boxName) {
          gsap.to(cube.position, {
            duration: 1,
            x: face,
            y: pos.y,
            z: pos.x,
            ease: "power2.inOut",
            onUpdate: () => {
              cube.userData.boundBox.position.copy(cube.position);
            }
          });
      }
    });
  });



}, 500);
}















function sequencePos() {

  setTimeout(() => {
    // Fix rotations for all boxes
    boxes.forEach(cube => {
      cube.rotation.set(-Math.PI / 2, 0, 0);
      cube.userData.boundBox.rotation.set(-Math.PI / 2, 0, 0);
    });

    // Find all referenced boxes
    let referencedBoxes = new Set();
    boxes.forEach(box => {
      box.userData.sequence.forEach(seq => referencedBoxes.add(seq));
    });

    let seqBoxes = boxes.filter(box => box.userData.sequence.length > 0);
    // Identify start objects (not referenced anywhere)
    let startObjects = seqBoxes.filter(box => !referencedBoxes.has(box));

    // Positioning parameters
    let xStart = -bigCubeSize / 3;  // Start X position
    let yFixed = bigCubeSize / 2;   // Base Y position
    let zStart = -bigCubeSize / 2;  // Start Z position
    let xSpacing = boxSize * 35;  // Horizontal distance
    let ySpacing = boxSize * 10;   // Vertical distance for branches
    let rowSpacing = boxSize * 10; // Space between independent sequences

    let destinationArray = {}; // Store target positions
    let placed = new Set();    // Track placed boxes
    let queue = [];            // Queue for BFS traversal

    // Position start objects in a vertical row
    startObjects.forEach((box, index) => {
        let xPos = xStart;
        let zPos = zStart + index * rowSpacing; // Each sequence starts on a different Z line
        destinationArray[box.userData.name] = { x: xPos, y: yFixed, z: zPos };
        placed.add(box);
        queue.push({ box, x: xPos, y: yFixed, z: zPos }); // Store zPos in queue
    });





    // Position subsequent objects with true alternating branching
    while (queue.length > 0) {
        let { box, x, y, z } = queue.shift(); // Get the z position from queue
        let nextX = x + xSpacing; // Move next boxes to the right
        let branchCount = box.userData.sequence.length;

        if (branchCount === 1) {
            // Single continuation follows parent’s z position
            let nextBox = box.userData.sequence[0];
            if (!placed.has(nextBox)) {
                destinationArray[nextBox.userData.name] = { x: nextX, y: y, z: z };
                placed.add(nextBox);
                queue.push({ box: nextBox, x: nextX, y: y, z: z });
            }
        } else {
            // Multiple branches: alternate between above and below
            let yDirection = 1; // Start with up movement

            box.userData.sequence.forEach((nextBox, i) => {
                if (!placed.has(nextBox)) {
                    let newY = y + (yDirection * Math.ceil(i / 2) * ySpacing);
                    yDirection *= -1; // Toggle direction (up/down)

                    // Keep the same z-position as parent
                    destinationArray[nextBox.userData.name] = { x: nextX, y: newY, z: z };
                    placed.add(nextBox);
                    queue.push({ box: nextBox, x: nextX, y: newY, z: z });
                }
            });
        }
    }

 let face = bigCubeSize / 2;









    // First pass: Calculate max X positions
    let maxXPositions = {};
    boxes.forEach(cube => {
      let pos = destinationArray[cube.userData.name];
      if (pos) {
        let refArray = boxes.filter(c => c.userData.sequence.includes(cube))
                            .map(c => destinationArray[c.userData.name]);
        
        let maxX = Math.max(-1000, ...refArray.map(posRef => posRef ? posRef.x : 0));
        maxXPositions[cube.userData.name] = maxX + xSpacing;

      }
    });


    boxes.forEach(cube => {
      let pos = destinationArray[cube.userData.name];
      
      if (pos) {
        if (pos.x > 0){
        pos.x = maxXPositions[cube.userData.name];
        }


        gsap.to(cube.position, {
          duration: 1,
          x: pos.x,
          y: face, // Adjust for scene positioning
          z: pos.z + pos.y,
          ease: "power2.inOut",
          onUpdate: () => {
            cube.userData.boundBox.position.copy(cube.position);
          }
        });
      }
    });



  }, 500);
}







// function sequencePos() {

//   setTimeout(() => {
//     // Fix rotations for all boxes
//     boxes.forEach(cube => {
//       cube.rotation.set(-Math.PI / 2, 0, 0);
//       cube.userData.boundBox.rotation.set(-Math.PI / 2, 0, 0);
//     });

//     // Find all referenced boxes
//     let referencedBoxes = new Set();
//     boxes.forEach(box => {
//       box.userData.sequence.forEach(seq => referencedBoxes.add(seq));
//     });

//     let seqBoxes = boxes.filter(box => box.userData.sequence.length > 0);
//     // Identify start objects (not referenced anywhere)
//     let startObjects = seqBoxes.filter(box => !referencedBoxes.has(box));

//     // Positioning parameters
//     let xStart = -bigCubeSize / 3;  // Start X position
//     let yFixed = bigCubeSize / 2;   // Base Y position
//     let zStart = -bigCubeSize / 2;  // Start Z position
//     let xSpacing = boxSize * 35;  // Horizontal distance
//     let ySpacing = boxSize * 10;   // Vertical distance for branches
//     let rowSpacing = boxSize * 10; // Space between independent sequences

//     let destinationArray = {}; // Store target positions
//     let placed = new Set();    // Track placed boxes
//     let queue = [];            // Queue for BFS traversal

//     // Position start objects in a vertical row
//     startObjects.forEach((box, index) => {
//         let xPos = xStart;
//         let zPos = zStart + index * rowSpacing; // Each sequence starts on a different Z line
//         destinationArray[box.userData.name] = { x: xPos, y: yFixed, z: zPos };
//         placed.add(box);
//         queue.push({ box, x: xPos, y: yFixed, z: zPos }); // Store zPos in queue
//     });





//     // Position subsequent objects with true alternating branching
//     while (queue.length > 0) {
//         let { box, x, y, z } = queue.shift(); // Get the z position from queue
//         let nextX = x + xSpacing; // Move next boxes to the right
//         let branchCount = box.userData.sequence.length;

//         if (branchCount === 1) {
//             // Single continuation follows parent’s z position
//             let nextBox = box.userData.sequence[0];
//             if (!placed.has(nextBox)) {
//                 destinationArray[nextBox.userData.name] = { x: nextX, y: y, z: z };
//                 placed.add(nextBox);
//                 queue.push({ box: nextBox, x: nextX, y: y, z: z });
//             }
//         } else {
//             // Multiple branches: alternate between above and below
//             let yDirection = 1; // Start with up movement

//             box.userData.sequence.forEach((nextBox, i) => {
//                 if (!placed.has(nextBox)) {
//                     let newY = y + (yDirection * Math.ceil(i / 2) * ySpacing);
//                     yDirection *= -1; // Toggle direction (up/down)

//                     // Keep the same z-position as parent
//                     destinationArray[nextBox.userData.name] = { x: nextX, y: newY, z: z };
//                     placed.add(nextBox);
//                     queue.push({ box: nextBox, x: nextX, y: newY, z: z });
//                 }
//             });
//         }
//     }

//  let face = bigCubeSize / 2;









//     // First pass: Calculate max X positions
//     let maxXPositions = {};
//     boxes.forEach(cube => {
//       let pos = destinationArray[cube.userData.name];
//       if (pos) {
//         let refArray = boxes.filter(c => c.userData.sequence.includes(cube))
//                             .map(c => destinationArray[c.userData.name]);
        
//         let maxX = Math.max(-1000, ...refArray.map(posRef => posRef ? posRef.x : 0));
//         maxXPositions[cube.userData.name] = maxX + xSpacing;

//       }
//     });


//     boxes.forEach(cube => {
//       let pos = destinationArray[cube.userData.name];
      
//       if (pos) {
//         if (pos.x > 0){
//         pos.x = maxXPositions[cube.userData.name];
//         }


//         gsap.to(cube.position, {
//           duration: 1,
//           x: pos.x,
//           y: face, // Adjust for scene positioning
//           z: pos.z + pos.y,
//           ease: "power2.inOut",
//           onUpdate: () => {
//             cube.userData.boundBox.position.copy(cube.position);
//           }
//         });
//       }
//     });



//   }, 500);
// }











//pca computation

function computeTF(doc) {
  const tf = {};
  const docLength = doc.length;
  doc.forEach(word => {
      tf[word] = (tf[word] || 0) + 1;
  });

  for (let word in tf) {
      tf[word] /= docLength;
  }

  return tf;
}

function computeIDF(corpus) {
  const idf = {};
  const docCount = corpus.length;

  corpus.forEach(doc => {
      const uniqueWords = new Set(doc);
      uniqueWords.forEach(word => {
          idf[word] = (idf[word] || 0) + 1;
      });
  });

  for (let word in idf) {
      idf[word] = Math.log(docCount / idf[word]);
  }

  return idf;
}

function computeTFIDF(corpus) {
  const idf = computeIDF(corpus);
  return corpus.map(doc => {
      const tf = computeTF(doc);
      const tfidf = {};

      for (let word in tf) {
          tfidf[word] = tf[word] * idf[word] || 0;
      }

      return tfidf;
  });
}

// pca for text
function pcaText(corpus) {
  const tfidfVectors = computeTFIDF(corpus);
  const maxLength = Math.max(...tfidfVectors.map(doc => Object.keys(doc).length));

  let vectors = tfidfVectors.map(doc => {
    const vector = Object.values(doc);
    while (vector.length < maxLength) {
      vector.push(0);
    }
    return vector;
  });



  if (vectors.length === 0) {
    console.error("PCA input vectors are empty.");
    return [];
  }
  

  const pca = new PCA(vectors);
  const reducedVectors = pca.predict(vectors);

  const minX = Math.min(...reducedVectors.data.map(v => v[0]));
  const maxX = Math.max(...reducedVectors.data.map(v => v[0]));
  const minY = Math.min(...reducedVectors.data.map(v => v[1]));
  const maxY = Math.max(...reducedVectors.data.map(v => v[1]));

  let positions = reducedVectors.data.map((v, index) => ({
    boxName: boxes[index].userData.name,
    x: normalize(v[0], minX, maxX, -bigCubeSizeSIM / 2, bigCubeSizeSIM / 2),
    y: normalize(v[1], minY, maxY, -bigCubeSizeSIM / 2, bigCubeSizeSIM / 2),
    z: 0 // 2D projection, so z is 0
  }));

  return positions;
}


//adjustments
function adjustPos(initialPositions, reference, iterations = 50, attractionStrength = 0.2) {
  
  let positions = initialPositions.map(pos => ({ ...pos })); // Deep copy

  for (let i = 0; i < iterations; i++) {
      let totalMovement = 0;

      positions.forEach((pos, index) => {
          let box = boxes.find(b => b.userData.name === pos.boxName);
          if (!box || !box.userData.relations) return;

          let forceX = 0, forceY = 0;


      if (reference === "parents") {
        if (box.userData.parents.length < 1) return;
        box.userData.parents.forEach((parent) => {
          let relatedPos = positions.find(p => p.boxName === parent.userData.name);
          if (relatedPos) {
              let dx = relatedPos.x - pos.x;
              let dy = relatedPos.y - pos.y;
              let distance = Math.sqrt(dx * dx + dy * dy);
              
              // Apply attraction force
              forceX += (dx / distance) * attractionStrength;
              forceY += (dy / distance) * attractionStrength;
          }
      });
      }else if (reference === "relations") {

        if (box.userData.relations.length < 1) return;
          // Attraction forces
          box.userData.relations.forEach(([relatedItem, _]) => {
              let relatedPos = positions.find(p => p.boxName === relatedItem.userData.name);
              if (relatedPos) {
                  let dx = relatedPos.x - pos.x;
                  let dy = relatedPos.y - pos.y;
                  let distance = Math.sqrt(dx * dx + dy * dy);
                  
                  // Apply attraction force
                  forceX += (dx / distance) * attractionStrength;
                  forceY += (dy / distance) * attractionStrength;
              }
          });

        }else if (reference === "children") {
          if (box.userData.children.length < 1) return;
          box.userData.children.forEach((parent) => {
            let relatedPos = positions.find(p => p.boxName === parent.userData.name);
            if (relatedPos) {
                let dx = relatedPos.x - pos.x;
                let dy = relatedPos.y - pos.y;
                let distance = Math.sqrt(dx * dx + dy * dy);
                
                // Apply attraction force
                forceX += (dx / distance) * attractionStrength;
                forceY += (dy / distance) * attractionStrength;
            }
        });
      }else if (reference === "sequence") {
        if (box.userData.sequence.length < 1) return;
        box.userData.sequence.forEach((parent) => {
          let relatedPos = positions.find(p => p.boxName === parent.userData.name);
          if (relatedPos) {
              let dx = relatedPos.x - pos.x;
              let dy = relatedPos.y - pos.y;
              let distance = Math.sqrt(dx * dx + dy * dy);
              
              // Apply attraction force
              forceX += (dx / distance) * attractionStrength;
              forceY += (dy / distance) * attractionStrength;
          }
      });
    }
  

          // Update position
          pos.x += forceX;
          pos.y += forceY;
          totalMovement += Math.abs(forceX) + Math.abs(forceY);
      });

      if (totalMovement < 0.001) break; // Stop if movement is very small
  }

  return positions;
}


//overlapping
function overlapPrevention(initialPositions, iterations = 100, repulsionStrength = 0.9, minDistance = 30) {
  let finalPositions = initialPositions.map(pos => ({ ...pos })); // Deep copy
  
  // Calculate the bounding box sizes for all boxes once, outside the loop
  const boxSizes = finalPositions.map(pos => {
    let box = boxes.find(b => b.userData.name === pos.boxName);
        if (!box) {
            console.error(`No box found for name: ${pos.boxName}`);
            return;
        }


    if (box && box.userData.boundBox) {
      const textBoundingBox = new THREE.Box3().setFromObject(box);
      const size = new THREE.Vector3();
      textBoundingBox.getSize(size);  // Get the size of the bounding box
      return size;  // Return the bounding box size
    }
    return null; // Handle the case where no box is found
  });

  // Loop through iterations to apply repulsion forces
  for (let i = 0; i < iterations; i++) {
    let totalMovement = 0;

    finalPositions.forEach((pos, index) => {
      let box = boxes.find(b => b.userData.name === pos.boxName);
      if (!box || !box.userData.boundBox) return;

      let forceX = 0, forceY = 0;

      finalPositions.forEach((otherPos, otherIndex) => {
        if (index !== otherIndex) {
          // Get the box size for the other position
          const otherBoxSize = boxSizes[otherIndex];
          if (!otherBoxSize) return; // Skip if no valid box size

          let dx = otherPos.x - pos.x;
          let dy = otherPos.y - pos.y;

          // Calculate the actual distance between boxes
          const distance = Math.sqrt(dx * dx + dy * dy);

          // Calculate the threshold based on the bounding box sizes in both x and y directions
          const thresholdX = (boxSizes[index].x + otherBoxSize.x) / 2; // Average width of both boxes
          const thresholdY = (boxSizes[index].y + otherBoxSize.y) / 2; // Average height of both boxes

          // If the distance in either x or y direction is smaller than the threshold, apply repulsion
          if (Math.abs(dx) < thresholdX || Math.abs(dy) < thresholdY) {
            // Calculate repulsion force proportionally based on the distance
            let repulsionForceX = repulsionStrength * (thresholdX - Math.abs(dx)) / (Math.abs(dx) + 0.001); // Prevent division by zero
            let repulsionForceY = repulsionStrength * (thresholdY - Math.abs(dy)) / (Math.abs(dy) + 0.001); // Prevent division by zero

            // Apply the forces
            forceX += repulsionForceX * (dx / Math.abs(dx)); // Apply force in the direction of dx
            forceY += repulsionForceY * (dy / Math.abs(dy)); // Apply force in the direction of dy
          }
        }
      });

      // Update position
      pos.x += forceX;
      pos.y += forceY;


      if (!boxSizes[index] || !boxSizes[index].x) {
        console.error(`Invalid box size for ${pos.boxName}`);
        return;
      }
      



      // Calculate total movement for breaking the loop if movement is small
      totalMovement += Math.abs(forceX) + Math.abs(forceY);
    });


    

    // Stop if movement is very small (to prevent redundant iterations)
    if (totalMovement < 0.001) break;
  }

  return finalPositions;
}

function normalize(value, min, max, rangeMin, rangeMax) {
  if (min === max) return rangeMin;
  if (max - min === 0) return (rangeMin + rangeMax) / 2; // Avoid division by zero
  return rangeMin + ((value - min) / (max - min)) * (rangeMax - rangeMin);
}












function updateBoundingBoxes() {
  const statusClusters = {};
  boxes.forEach(cube => {
    if (cube.visible) {
      const status = cube.userData.status || "default";
      if (!statusClusters[status]) statusClusters[status] = [];
      statusClusters[status].push(cube);
    }
  });

  Object.entries(statusClusters).forEach(([status, cubes]) => {
    const boundingBox = new THREE.Box3();
    cubes.forEach(cube => boundingBox.expandByObject(cube));

    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    boundingBox.getCenter(center);
    boundingBox.getSize(size);

    // Create or update the outline
    let statusOutline = scene.getObjectByName(`statusOutline_${status}`);
    if (!statusOutline) {
      const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
      const edges = new THREE.EdgesGeometry(boxGeometry);
      const lineMaterial = new THREE.LineBasicMaterial({ color: 0xF7E0C0, linewidth: 2 });
      statusOutline = new THREE.LineSegments(edges, lineMaterial);
      statusOutline.name = `statusOutline_${status}`;
      //scene.add(statusOutline);
    }

    // Update the outline position and scale
    statusOutline.position.copy(center);
    statusOutline.scale.set(size.x * 1.2, size.y * 1.2, size.z * 1.2);
  });
}











//simulations

function structureSimulation() {
  const levelSpacing = boxSize * 10;   // Distance between levels (y-axis)
  const groupSpacing = boxSize * 2;   // Distance between groups (x-axis)
  const boxSpacing = boxSize / 3;    
  const zFrontFace = bigCubeSize / 2;

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  const levels = {};
  let structureBoxes = boxes.filter(box => (box.userData.children.length > 0 || box.userData.parents.length > 0));

  // Group cubes by level
  structureBoxes.forEach(cube => {
    const level = cube.userData.level;
    if (!levels[level]) levels[level] = [];
    levels[level].push(cube);
  });

  const totalLevels = Object.keys(levels).length;
  const totalHeight = (totalLevels - 1) * levelSpacing;
  const centerYOffset = totalHeight / 2;

  Object.keys(levels).forEach((yLevel, levelIndex) => {
    const cubesAtLevel = levels[yLevel];
    const clusters = {};

    // Group cubes by `group`
    cubesAtLevel.forEach(cube => {
      const cluster = cube.userData.group;
      if (!clusters[cluster]) clusters[cluster] = [];
      clusters[cluster].push(cube);
    });

    let totalWidth = 0;
    let maxClusterHeight = 0;

    // Calculate total width and max height for the level
    Object.values(clusters).forEach(cubesInCluster => {
      let clusterWidth = 0;
      let clusterHeight = 0;
      cubesInCluster.forEach(cube => {
        if (!cube.userData.boundBox.geometry.boundingBox) {
          cube.userData.boundBox.geometry.computeBoundingBox();
        }
        const boundBox = cube.userData.boundBox.geometry.boundingBox;
        clusterWidth += boundBox.max.x - boundBox.min.x + boxSpacing;
        clusterHeight = Math.max(clusterHeight, boundBox.max.y - boundBox.min.y);
      });
      totalWidth += clusterWidth;
      maxClusterHeight = Math.max(maxClusterHeight, clusterHeight);
    });

    totalWidth += (Object.keys(clusters).length - 1) * groupSpacing;
    const levelOffsetX = -totalWidth / 2;
    let currentX = levelOffsetX;

    Object.keys(clusters).forEach(clusterKey => {
      const cubesInCluster = clusters[clusterKey];
      let clusterWidth = 0;

      cubesInCluster.forEach((cube, i) => {
        if (!cube.userData.boundBox.geometry.boundingBox) {
          cube.userData.boundBox.geometry.computeBoundingBox();
        }
        const boundBox = cube.userData.boundBox.geometry.boundingBox;
        const cubeWidth = boundBox.max.x - boundBox.min.x;
        const cubeHeight = boundBox.max.y - boundBox.min.y;

        const x = currentX + clusterWidth + cubeWidth / 2;
        const y = centerYOffset - levelIndex * levelSpacing - (maxClusterHeight - cubeHeight) / 2;
        const z = zFrontFace;

        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        minZ = Math.min(minY, z);
        maxZ = Math.max(maxY, z);

        // Assign precomputed positions without animation

        clusterWidth += cubeWidth + boxSpacing;
      });

      currentX += clusterWidth + groupSpacing;
    });
  });

  if (minX === -Infinity) minX = 0;
  if (minY === -Infinity) minX = 0;
  if (minZ === -Infinity) minX = 0;
  if (maxX === Infinity) minX = 0;
  if (maxY === Infinity) minX = 0;
  if (maxZ === Infinity) minX = 0;



  const result = new THREE.Vector3(
    maxX - minX,
    maxY - minY,
    maxZ - minZ

  );
  
  return result;


}


function relationsSimulation() {

let result = new THREE.Vector3(0, 0, 0);
  return result;

}



function themesSimulation() {

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;


      // Rotate cubes to face the correct direction
      let themesBoxes = boxes.filter(box => box.visible === true);
  
      boxes.forEach(cube => {
        cube.rotation.set(0, -Math.PI, 0);
        cube.userData.boundBox.rotation.set(0, -Math.PI, 0);
      });
  
      // Base constants
      const baseClusterSpacing = boxSize * 10; // Spacing between cluster centers
      const baseBoxSpread = boxSize * 3; // Initial spread within clusters
      const minClusterDistance = boxSize * 3; // Minimum distance between cluster centers
      const faceZ = -bigCubeSize / 2;
  
      // Group cubes by status
      const statusClusters = {};
      themesBoxes.forEach(cube => {
        const status = cube.userData.status || "default";
        if (!statusClusters[status]) statusClusters[status] = [];
        statusClusters[status].push(cube);
      });
  
      const statusKeys = Object.keys(statusClusters);
  
      // Initialize cluster centers
      const clusterCenters = statusKeys.map((status, index) => {
        const angle = (index / statusKeys.length) * Math.PI * 2;
        const radius = baseClusterSpacing * Math.sqrt(statusKeys.length);
        return new THREE.Vector3(
          Math.cos(angle) * radius,
          Math.sin(angle) * radius,
          faceZ
        );
      });
  
      // Force-directed placement of cluster centers
      for (let iteration = 0; iteration < 100; iteration++) {
        statusKeys.forEach((status, i) => {
          let forceX = 0, forceY = 0;
          statusKeys.forEach((otherStatus, j) => {
            if (i !== j) {
              const dx = clusterCenters[i].x - clusterCenters[j].x;
              const dy = clusterCenters[i].y - clusterCenters[j].y;
              const distance = Math.sqrt(dx * dx + dy * dy) || 1;
              const force = Math.max(0, minClusterDistance - distance) / distance;
              forceX += dx * force;
              forceY += dy * force;
            }
          });
          clusterCenters[i].x += forceX * 0.1;
          clusterCenters[i].y += forceY * 0.4;
        });
      }
  
      // Position cubes within clusters
      statusKeys.forEach((status, clusterIndex) => {
        const cubesInStatus = statusClusters[status];
        const clusterCenter = clusterCenters[clusterIndex];
  
        // Initialize positions within cluster
        cubesInStatus.forEach(cube => {
          cube.position.x = clusterCenter.x + (Math.random() - 0.5) * baseBoxSpread;
          cube.position.y = clusterCenter.y + (Math.random() - 0.5) * baseBoxSpread;
          cube.position.z = faceZ;
        });
  
        // Force-directed placement within cluster
        for (let iteration = 0; iteration < 50; iteration++) {
          cubesInStatus.forEach((cube, i) => {
            let forceX = 0, forceY = 0;
            
            cubesInStatus.forEach((otherCube, j) => {
              if (i !== j) {
                const dx = cube.position.x - otherCube.position.x;
                const dy = cube.position.y - otherCube.position.y;
                const distance = Math.sqrt(dx * dx + dy * dy) || 1;
                const force = (30 - distance) / distance;
                forceX += dx * force;
                forceY += dy * force;
              }
            });
  
            // Add a centering force
            forceX += (clusterCenter.x - cube.position.x) * 0.1;
            forceY += (clusterCenter.y - cube.position.y) * 0.1;
  
            cube.position.x += forceX * 0.05;
            cube.position.y += forceY * 0.05;


            minX = Math.min(minX, cube.position.x);
            maxX = Math.max(maxX, cube.position.x);
            minY = Math.min(minY, cube.position.y);
            maxY = Math.max(maxY, cube.position.y);
          });
          
          

        }
      });

      if (minX === -Infinity) minX = 0;
      if (minY === -Infinity) minX = 0;
      if (minZ === -Infinity) minX = 0;
      if (maxX === Infinity) minX = 0;
      if (maxY === Infinity) minX = 0;
      if (maxZ === Infinity) minX = 0;

      const result = new THREE.Vector3(
        maxX - minX,
        maxY - minY,
        maxZ - minZ
      );
      
      return result;


  }

function sequenceSimulation() {
  let xposit = [];
  let yposit = [];

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  // Fix rotations for all boxes
  boxes.forEach(cube => {
      cube.rotation.set(-Math.PI / 2, 0, 0);
      cube.userData.boundBox.rotation.set(-Math.PI / 2, 0, 0);
  });

  // Find all referenced boxes
  let referencedBoxes = new Set();
  boxes.forEach(box => {
      box.userData.sequence.forEach(seq => referencedBoxes.add(seq));
  });

  let seqBoxes = boxes.filter(box => box.userData.sequence.length > 0);
  // Identify start objects (not referenced anywhere)
  let startObjects = seqBoxes.filter(box => !referencedBoxes.has(box));

  // Positioning parameters
  let xStart = -bigCubeSize / 3;  // Start X position
  let yFixed = bigCubeSize / 2;   // Base Y position
  let zStart = -bigCubeSize / 2;  // Start Z position
  let xSpacing = boxSize * 35;  // Horizontal distance
  let ySpacing = boxSize * 5;   // Vertical distance for branches
  let rowSpacing = boxSize * 5; 

  let destinationArray = {}; // Store target positions
  let placed = new Set();    // Track placed boxes
  let queue = [];            // Queue for BFS traversal

  let rowCount = 0; // Initialize row counter

  // Position start objects in a vertical row
  startObjects.forEach((box, index) => {
      let xPos = xStart;
      let zPos = zStart + index * rowSpacing; // Each sequence starts on a different Z line
      destinationArray[box.userData.name] = { x: xPos, y: yFixed, z: zPos };
      placed.add(box);
      queue.push({ box, x: xPos, y: yFixed, z: zPos });
      rowCount++; // Increment row count for the start object
  });

  // Position subsequent objects with alternating branching
  while (queue.length > 0) {
      let { box, x, y, z } = queue.shift();
      let nextX = x + xSpacing;
      let branchCount = box.userData.sequence.length;

      if (branchCount === 1) {
          // Single continuation follows parent's z position
          let nextBox = box.userData.sequence[0];
          if (!placed.has(nextBox)) {
              destinationArray[nextBox.userData.name] = { x: nextX, y: y, z: z };
              placed.add(nextBox);
              queue.push({ box: nextBox, x: nextX, y: y, z: z });
          }
      } else {
          // Multiple branches alternate between above and below
          let yDirection = 1; // Start with up movement

          box.userData.sequence.forEach((nextBox, i) => {
              if (!placed.has(nextBox)) {
                  let newY = y + (yDirection * Math.ceil(i / 2) * ySpacing);
                  yDirection *= -1; // Toggle direction (up/down)

                  // Keep the same z-position as parent
                  destinationArray[nextBox.userData.name] = { x: nextX, y: newY, z: z };
                  placed.add(nextBox);
                  queue.push({ box: nextBox, x: nextX, y: newY, z: z });
                  rowCount++; // Increment row count for each branch
              }
          });
      }
  }

  // Calculate max X positions properly
  let maxXPositions = {};
  boxes.forEach(cube => {
      let pos = destinationArray[cube.userData.name];
      if (pos) {
          let parentBoxes = boxes.filter(c => c.userData.sequence.includes(cube));
          let refArray = parentBoxes.map(c => destinationArray[c.userData.name]);

          let maxX = Math.max(...refArray.map(posRef => posRef ? posRef.x : xStart));
          maxXPositions[cube.userData.name] = maxX + xSpacing;
      }
  });

  // Adjust X positions
  boxes.forEach(cube => {
      let pos = destinationArray[cube.userData.name];

      if (pos) {
          if (pos.x > 0) {
              pos.x = maxXPositions[cube.userData.name];
          }

          pos.z += (cube.userData.sequence.length > 1 ? 0 : pos.y);

          xposit.push(pos.x);
          yposit.push(pos.z);
      }
  });

  // Calculate min/max bounds
  maxX = Math.max(...xposit);
  maxY = Math.max(...yposit);
  minX = Math.min(...xposit);
  minY = Math.min(...yposit);



  if (minX === -Infinity) minX = 0;
  if (minY === -Infinity) minX = 0;
  if (minZ === -Infinity) minX = 0;
  if (maxX === Infinity) minX = 0;
  if (maxY === Infinity) minX = 0;
  if (maxZ === Infinity) minX = 0;

  const positionSe = new THREE.Vector3(
      maxX - minX,
      maxY - minY,
      maxZ - minZ
  );

  // Return both the result and the number of rows
  return { positionSe, rowCount };
}


function latentSimulation() {
    
  let result = new THREE.Vector3(0, 0, 0);
  return result;
  return result;

}



// Create a helper function to add thicker edges
function addThickEdges(geometry, material, aroundPosition) {
  const edges = new THREE.EdgesGeometry(geometry);
    const lineSegments = new THREE.LineSegments(edges, material);
    lineSegments.position.copy(aroundPosition);
  scene.add(lineSegments); 

  const positions = lineSegments.geometry.attributes.position.array;
  for (let i = 0; i < positions.length; i += 6) {
    const start = new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]);
    const end = new THREE.Vector3(positions[i + 3], positions[i + 4], positions[i + 5]);
    
    const direction = new THREE.Vector3().subVectors(end, start).normalize();
    const length = start.distanceTo(end);
    
    const cylinderGeometry = new THREE.CylinderGeometry(3, 3, length, 8);
    const cylinder = new THREE.Mesh(cylinderGeometry, material);
    
    cylinder.position.copy(start).add(end).multiplyScalar(0.5);
    
    const axis = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(axis, direction);
    cylinder.rotation.setFromQuaternion(quaternion);
    
    cylinder.position.add(aroundPosition);
    
    scene.add(cylinder);
  }
}



function adjustBigCubeSize(){


  //vars
  let positionS =  structureSimulation();
  let positionR =  relationsSimulation();
  let positionT = themesSimulation();
  let { positionSe, rowCount } = sequenceSimulation();
  let positionL = latentSimulation();

  let wordsizeAccount = boxSize * 5;

  let posMax = Math.max(positionS.x, positionR.x, positionT.x, positionSe.x, positionL.x, positionS.y, positionR.y, positionT.y, positionSe.y, positionL.y, positionS.z, positionR.z, positionT.z, positionSe.z, positionL.z);

console.log("podMax", posMax);

//allcube
  const aroundMaterial = new THREE.LineBasicMaterial({
    color: 0xf7f9f9 ,  // Line color
    linewidth: 30,      // Line thickness
    transparent: false, // Transparency (optional)
    opacity: 1         // Opacity (optional)
  });

    //bigCubeSize = posMax;


    const allGeometry = new THREE.BoxGeometry(bigCubeSize + wordsizeAccount, bigCubeSize + wordsizeAccount, bigCubeSize + wordsizeAccount);
    const allPosition = new THREE.Vector3(0, 0, 0);
    //addThickEdges(allGeometry, aroundMaterial, allPosition);




//infill
    const cubeMaterial = new THREE.MeshBasicMaterial({
      color: black,
      wireframe: false,
      transparent: false,
      opacity: 1
    })
    const allminusGeometry = new THREE.BoxGeometry(bigCubeSize + wordsizeAccount / 2, bigCubeSize + wordsizeAccount / 2, bigCubeSize + wordsizeAccount / 2);
    const bigCubeMesh = new THREE.Mesh(allminusGeometry, cubeMaterial);
    bigCubeMesh.name = "bigCubeMesh";
    scene.add(bigCubeMesh);

 };





















  window.addEventListener('resize', function () {
    const container = document.getElementById('threejs-container');
    
    // Get the container dimensions
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Update the renderer to match the container size
    renderer.setSize(width, height);
    
    // Maintain the correct aspect ratio for the camera
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
});

  

  function animate() {
    
    if (renderer && scene && camera) {
      requestAnimationFrame(animate);
      if(mode === structure && explore){ //mode === structure &&
        camera.position.lerp(targetPosition, 0.05);
      }

      renderer.render(scene, camera);
    } else {
      console.warn('Three.js scene, camera, or renderer is not initialized.');
    }
  }
  animate();


//initialising and handling

// Function to prepare box data
function prepareBoxData(name, description, status, parents = [], relations = [], sequence = []) {
  return {
      name: String(name),
      description: String(description),
      status: String(status),
      parents: Array.isArray(parents) ? parents : [parents].filter(Boolean),
      relations: Array.isArray(relations) ? relations.filter(r => Array.isArray(r) && r.length === 2) : [],
      sequence: Array.isArray(sequence) ? sequence : [sequence].filter(Boolean),
  };
}



function processAllBoxes(boxesData) {
  const createdBoxes = new Map();

  // Phase 1: Create all boxes
  boxesData.forEach(data => {
      const box = createBox(data.name, data.description, data.status);
      createdBoxes.set(data.name, box);
  });

  // Phase 2: Create missing parents first
  boxesData.forEach(data => {
      data.parents.forEach(parentName => {
          if (!createdBoxes.has(parentName)) {
              // Add missing parent box before processing children
              console.warn(`Parent ${parentName} for ${data.name} is missing. Creating...`);
              boxesData.push(prepareBoxData(parentName, null, null, null, null, null));
              let createdNew = createBox(parentName, "superordinate element", "superordinate element");
              createdBoxes.set(parentName, createdNew);
              enhanceBox(createdNew, [], [], []); // Parents should be enhanced first
          }
      });
  });

  



  boxesData.forEach(data => {
    data.relations.forEach(([relation, description]) => {
        if (!createdBoxes.has(relation)) {
            // Add missing parent box before processing children
            boxesData.push(prepareBoxData(relation, null, null, null, null, null));
            let createdNewR = createBox(relation, "superordinate element", "superordinate element");
            createdBoxes.set(relation, createdNewR);
            enhanceBox(createdNewR, [], [], []); // Parents should be enhanced first
        }
    });
});


boxesData.forEach(data => {
  data.sequence.forEach(seq => {
      if (!createdBoxes.has(seq)) {
          // Add missing parent box before processing children
          boxesData.push(prepareBoxData(seq, null, null, null, null, null));
          let createdNewS = createBox(seq, "superordinate element", "superordinate element");
          createdBoxes.set(seq, createdNewS);
          enhanceBox(createdNewS, [], [], []); // Parents should be enhanced first
      }
  });
});






// Phase 3: Enhance all boxes after ensuring parents exist
boxesData.forEach(data => {
  const box = createdBoxes.get(data.name);

  // Ensure box exists before continuing
  if (!box) {
    console.warn(`Box for ${data.name} not found, skipping enhancement.`);
    return; // Skip this box if it doesn't exist
  }

  const parentBoxes = data.parents
    .map(parentName => createdBoxes.get(parentName))
    .filter(Boolean); // Remove any null or undefined parents

  const processedRelations = data.relations
    .map(([relatedName, description]) => 
        [createdBoxes.get(relatedName), description])
    .filter(([box]) => box); // Remove any null or undefined relations

  // Ensure sequenceBoxes contains only valid boxes
  const sequenceBoxes = data.sequence
    .map(sequenceName => createdBoxes.get(sequenceName))
    .filter(Boolean); // Filter out any null or undefined values

  // Add check to ensure sequenceBoxes is not empty before calling enhanceBox
  if (sequenceBoxes.length > 0) {
    enhanceBox(box, parentBoxes, processedRelations, sequenceBoxes);
  } else {
    enhanceBox(box, parentBoxes, processedRelations, []);  }
});







  // Step 4: **Now update levels after all boxes exist**
  updateZLevels();

  return Array.from(createdBoxes.values());
}





//populate
const boxesData = [];
boxDataList.forEach(data => {
  boxesData.push(prepareBoxData(data.name, data.description, data.status, data.parents, data.relations, data.sequence));
});
processAllBoxes(boxesData);
setTimeout(() => {
 
  adjustBigCubeSize()
  changeMode();
  structurePos();

}, 1000)

}








// click summary listener
document.getElementById("summary").addEventListener("click", async function () {
  try {
    console.log("Summarization started...");
    resetThreeScene();
    // clearContainer();

    // if (!rollButtonsContainer) {
    //   const rollButtonsContainer = document.createElement('div');
    //   rollButtonsContainer.id = 'roll-buttons-container';
    //   // Add your content to rollButtonsContainer if needed
    // }
    
    // if (!summaryContainer) {
    //   const summaryContainer = document.createElement('button');
    //   summaryContainer.id = 'summary';
    //   // Add your content to summaryContainer if needed
    // }
    
    // // Append them after creation
    // if (threejsContainer) {
    //   threejsContainer.appendChild(rollButtonsContainer);
    //   threejsContainer.appendChild(summaryContainer);
    // }


    await initializePage();
    console.log("Summarization complete.");
  } catch (error) {
    console.error("Error summarizing PDF:", error);
  }
});




