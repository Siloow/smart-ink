import React, { useState, useEffect } from 'react';
import { FaCalculator } from 'react-icons/fa';
import type { SceneData, PricingEstimate } from '../../../types';
import { pricingStorage, initializeBusinessTools } from '../../../businessToolsStorage';

interface PricingTabProps {
  currentScene: SceneData | null;
}

export default function PricingTab({ currentScene }: PricingTabProps) {
  const [pricingData, setPricingData] = useState({
    basePrice: 150,
    size: 'medium',
    complexity: 'moderate',
    timeEstimate: 2,
    rushOption: 'standard'
  });
  const [pricingEstimates, setPricingEstimates] = useState<PricingEstimate[]>([]);

  useEffect(() => {
    initializeBusinessTools();
  }, []);

  useEffect(() => {
    if (currentScene) {
      loadSceneData();
    }
  }, [currentScene]);

  const loadSceneData = () => {
    if (!currentScene) return;
    const estimates = pricingStorage.getEstimates(currentScene.id);
    setPricingEstimates(estimates);
  };

  const calculatePricing = () => {
    if (!currentScene) return;

    const estimate = pricingStorage.calculatePrice(
      pricingData.basePrice,
      pricingData.size,
      pricingData.complexity,
      pricingData.timeEstimate,
      pricingData.rushOption
    );

    estimate.sceneId = currentScene.id;
    estimate.createdBy = 'admin-1';

    if (pricingStorage.saveEstimate(estimate)) {
      setPricingEstimates(pricingStorage.getEstimates(currentScene.id));
    }
  };

  return (
    <div>
      <h4 style={{ margin: '0 0 16px 0' }}>Pricing Calculator</h4>
      
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>Base Price ($)</label>
        <input
          type="number"
          value={pricingData.basePrice}
          onChange={(e) => setPricingData({ ...pricingData, basePrice: Number(e.target.value) })}
          style={{
            width: '100%',
            padding: '8px',
            background: '#2a2a2a',
            border: '1px solid #333',
            borderRadius: '4px',
            color: 'white'
          }}
        />
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>Size</label>
        <select
          value={pricingData.size}
          onChange={(e) => setPricingData({ ...pricingData, size: e.target.value })}
          style={{
            width: '100%',
            padding: '8px',
            background: '#2a2a2a',
            border: '1px solid #333',
            borderRadius: '4px',
            color: 'white'
          }}
        >
          <option value="small">Small</option>
          <option value="medium">Medium</option>
          <option value="large">Large</option>
        </select>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>Complexity</label>
        <select
          value={pricingData.complexity}
          onChange={(e) => setPricingData({ ...pricingData, complexity: e.target.value })}
          style={{
            width: '100%',
            padding: '8px',
            background: '#2a2a2a',
            border: '1px solid #333',
            borderRadius: '4px',
            color: 'white'
          }}
        >
          <option value="simple">Simple</option>
          <option value="moderate">Moderate</option>
          <option value="complex">Complex</option>
        </select>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>Time Estimate (hours)</label>
        <input
          type="number"
          value={pricingData.timeEstimate}
          onChange={(e) => setPricingData({ ...pricingData, timeEstimate: Number(e.target.value) })}
          style={{
            width: '100%',
            padding: '8px',
            background: '#2a2a2a',
            border: '1px solid #333',
            borderRadius: '4px',
            color: 'white'
          }}
        />
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>Rush Option</label>
        <select
          value={pricingData.rushOption}
          onChange={(e) => setPricingData({ ...pricingData, rushOption: e.target.value })}
          style={{
            width: '100%',
            padding: '8px',
            background: '#2a2a2a',
            border: '1px solid #333',
            borderRadius: '4px',
            color: 'white'
          }}
        >
          <option value="standard">Standard (7 days)</option>
          <option value="rush">Rush (3 days)</option>
          <option value="emergency">Emergency (1 day)</option>
        </select>
      </div>

      <button
        onClick={calculatePricing}
        style={{
          width: '100%',
          padding: '12px',
          background: '#9333ea',
          border: 'none',
          color: 'white',
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '14px',
          fontWeight: '500'
        }}
      >
        Calculate Price
      </button>

      {pricingEstimates.length > 0 && (
        <div style={{ marginTop: '16px' }}>
          <h5 style={{ margin: '0 0 8px 0' }}>Recent Estimates</h5>
          {pricingEstimates.slice(0, 3).map(estimate => (
            <div
              key={estimate.id}
              style={{
                padding: '12px',
                background: '#2a2a2a',
                borderRadius: '6px',
                marginBottom: '8px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 'bold' }}>${estimate.totalPrice}</span>
                <span style={{ fontSize: '12px', color: '#888' }}>
                  {new Date(estimate.createdAt).toLocaleDateString()}
                </span>
              </div>
              <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>
                {estimate.breakdown.size.factor} • {estimate.breakdown.complexity.factor} • {estimate.timeEstimate}h
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
} 