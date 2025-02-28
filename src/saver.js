import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import { exec } from 'child_process';
import rateLimit from 'express-rate-limit';
import JSON5 from 'json5';
import fastJsonParse from 'fast-json-parse';


//config
    dotenv.config();
    const app = express();
    const port = 3000;
    const limiter = rateLimit({
      windowMs: 1000, // 1 second
      max: 1, // Allow only 1 request per second
    });
    app.use(cors());
    app.use(express.json());
    //app.use('/process-text', limiter);




// Preprocess text
    const preprocessText = (text) => {
      console.log("Step 1: Preprocessing text...");
      return text.replace(/\s+/g, ' ').trim();
    };


//LLM




const firstPrompt = (text, inputWord) => {

  return `How is "${inputWord}" described in the "${text}" ? Only focus on "${inputWord}", do not summarise the whole text.`;
};




  const prompt = (summaryText) => {
    return `This is the text: "${summaryText}". Extract all semantically relevant entities in **valid JSON format**.

  For each entity, provide:
  - "name": The entity's name.
  - "description": A short definition or explanation.
  - "status": Its category or classification.
  - "parents": A list of broader categories or whole-part relationships.
  - "relations": A list of tuples that show relationships with other entities and describe the nature of this relationship.

  Additionally, create **sequences of entities** where each entity naturally follows the other in a structured order. Each sequence should have at least three entities.

  **Example Output:**
  \`\`\`json
  {
    "entities": [
      {
        "name": "car",
        "description": "A wheeled motor vehicle used for transportation...",
        "status": "transportation mode",
        "parents": ["transportation", "vehicle"],
        "relations": [
          ["engine", "Powered by internal combustion or electric motors"],
          ["hybrid_car", "Uses both traditional and electric propulsion"]
        ]
      }
    ],
    "sequences": [
      ["car", "engine", "hybrid_car"],
      ["autonomous_vehicle", "AI_system", "LIDAR"]
    ]
  }
  \`\`\`
  Ensure output is in **valid JSON format**, without extra text.`;
  };









  

  async function summarize(text, inputWord) {
    try {
      console.log("summarize ...");
      
      const response = await axios.post('http://localhost:11434/api/generate', {
        model: 'deepseek-r1:7b',
        prompt: firstPrompt(text, inputWord),
        stream: false,
        temperature: 0.1
      });
  

      let answer = response.data.response
      const cleanedSummary = answer.replace(/<think>[\s\S]*?<\/think>/, '').trim();
  
      return cleanedSummary;
    } catch (error) {
      console.error("Error during entity extraction:", error);
      throw new Error("Entity extraction failed");
    }
  }










  async function extractData(text) {
    try {
      console.log("Fetching structured data from LLM...");
      
      const response = await axios.post('http://localhost:11434/api/generate', {
        model: 'llama3.1:8b',
        prompt: prompt(text),
        stream: false,
        temperature: 0.1
      });
  
      console.log("Raw LLM response:", response.data.response);

      const cleanedJson = extractJsonUsingRegex(response.data.response);
        if (!cleanedJson) {
            console.error("Failed to extract valid JSON");
        }

  
      const { entities, sequences } = parseEntities(cleanedJson);
  
      if (!entities || entities.length === 0) {
        throw new Error("No valid entities found in response.");
      }
  
      entities.forEach(entity => {
        entity.sequence = [];
      });

      // Integrate sequence data into entities
      sequences.forEach(seq => {
        for (let i = 0; i < seq.length - 1; i++) {
          const currentEntity = entities.find(e => e.name === seq[i]);
          const nextEntity = entities.find(e => e.name === seq[i + 1]);
  
          if (currentEntity) {
            currentEntity.sequence = currentEntity.sequence || [];
            currentEntity.sequence.push(nextEntity ? nextEntity.name : null);
          }
        }
      });
  
      return entities;
    } catch (error) {
      console.error("Error during entity extraction:", error);
      throw new Error("Entity extraction failed");
    }
  }




  function parseEntities(responseData) {
    try {
      console.log("Parsing JSON...");
  
      // If responseData is already an object, return it
      if (typeof responseData === 'object' && responseData !== null) {
        return responseData;
      }
  
      // If it's a string, try parsing it
      const parsed = JSON5.parse(responseData.trim());
      if (parsed.entities && parsed.sequences) {
        return parsed;
      }
  
      throw new Error("Invalid JSON format.");
    } catch (error) {
      console.error("Error parsing JSON:", error);
      return { entities: [], sequences: [] };
    }
  }
  


function extractJsonUsingRegex(responseText) {
  if (typeof responseText !== "string") {
    console.error("Expected a string in extractJsonUsingRegex but got:", responseText);
    return null;
  }

  const match = responseText.match(/\{[\s\S]*\}/);
  if (!match) {
    console.error("No JSON found in response");
    return null;
  }

  try {
    return JSON5.parse(match[0].trim());
  } catch (error) {
    console.error("Error parsing extracted JSON:", error);
    return null;
  }
}





//main
app.post('/process-text', async (req, res) => {
  console.log(`New request received at ${new Date().toISOString()}`);

  try {
    const { text, selectedInput } = req.body;
    if (!text || !selectedInput) {
      return res.status(400).json({ error: 'Text and Input Word are required' });
    }

    let cleanedText = preprocessText(text);
    console.log("input word: ", selectedInput);
    const summary = await summarize(cleanedText, selectedInput)



    console.log("Summary:", summary);


    const extractedData = await extractData(summary);

    res.json(extractedData);
  } catch (error) {
    console.error("Error processing request:", error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});




// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
